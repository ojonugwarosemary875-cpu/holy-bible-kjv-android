import { router, json, error, db, notifications, requireAuth } from '@appdeploy/sdk';
import { realtimeSubscriptionRoutes } from './realtime-subscribers';
import { ai } from '@appdeploy/sdk';

type PrayerPeriod = { enabled: boolean; time: string };
type PrayerReminder = {
  userId: string;
  timezone: string;
  enabled?: boolean;
  schedule?: { morning?: PrayerPeriod; afternoon?: PrayerPeriod; night?: PrayerPeriod };
  prayerRequest?: string;
  personalPrayerReminder?: PrayerPeriod;
  lastPersonalPrayerLocalDate?: string | null;
  lastSentLocalDate?: string | null;
  lastSentLocalDates?: Record<string, string>;
  lastPrayerIndices?: Record<string, number>;
};

const prayerChoices: Record<string, number[]> = {
  morning: [1, 2, 6, 7],
  afternoon: [2, 3, 5, 7],
  night: [0, 3, 4, 6]
};

export const checkPrayerReminders = async (_event: { type: 'cron'; name: string; scheduledTime: string }) => {
  const { items } = await db.list<PrayerReminder>('prayer_reminders', { limit: 100 });
  for (const item of items) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: item.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date());
      const part = (key: string) => parts.find(value => value.type === key)?.value || '';
      const localDate = part('year') + '-' + part('month') + '-' + part('day');
      const localMinute = Number(part('hour')) * 60 + Number(part('minute'));
      const schedule = item.schedule || { night: { enabled: item.enabled === true, time: (item as any).time || '21:00' } };
      const sentDates = { ...(item.lastSentLocalDates || {}) };
      const lastIndices = { ...(item.lastPrayerIndices || {}) };
      let changed = false;
      for (const period of ['morning', 'afternoon', 'night'] as const) {
        const setting = schedule[period];
        if (!setting?.enabled || !/^([01]\d|2[0-3]):[0-5]\d$/.test(setting.time || '')) continue;
        const [targetHour, targetMinute] = setting.time.split(':').map(Number);
        const elapsed = localMinute - (targetHour * 60 + targetMinute);
        if (elapsed < 0 || elapsed >= 10 || sentDates[period] === localDate) continue;
        const choices = prayerChoices[period];
        const available = choices.filter(index => index !== lastIndices[period]);
        const selectedIndex = available[Math.floor(Math.random() * available.length)] ?? choices[0];
        const titles: Record<string, string> = { morning: 'Your morning prayer is ready', afternoon: 'A little strength for your afternoon', night: 'A peaceful bedtime prayer awaits' };
        const bodies: Record<string, string> = { morning: 'Begin today with a fresh written prayer and God’s Word.', afternoon: 'Pause, breathe, and find encouragement in a new written prayer.', night: 'End your day with a quiet written prayer before you rest.' };
        const delivery = await notifications.send({
          userIds: [item.userId],
          notification: { title: 'Holy Bible KJV · ' + titles[period], body: bodies[period], url: '/?openPrayer=1&prayer=' + String(selectedIndex) },
          data: { kind: 'daily-prayer-reminder', period },
          ttlSeconds: 3600
        });
        if (delivery.failed > 0) console.error('Prayer reminder push delivery reported failures', { userId: item.userId, period, sent: delivery.sent, failed: delivery.failed, errors: delivery.errors || [] });
        if (delivery.sent > 0) { sentDates[period] = localDate; lastIndices[period] = selectedIndex; changed = true; }
      }
      const personal = item.personalPrayerReminder;
      if (personal?.enabled && item.prayerRequest?.trim() && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(personal.time || '')) {
        const [pointHour, pointMinute] = personal.time.split(':').map(Number);
        const pointElapsed = localMinute - (pointHour * 60 + pointMinute);
        if (pointElapsed >= 0 && pointElapsed < 10 && item.lastPersonalPrayerLocalDate !== localDate) {
          const delivery = await notifications.send({
            userIds: [item.userId],
            notification: { title: 'Holy Bible KJV · Your personal prayer time', body: item.prayerRequest.trim().slice(0, 150), url: '/?openPrayerPoint=1' },
            data: { kind: 'personal-prayer-point-reminder' },
            ttlSeconds: 3600
          });
          if (delivery.failed > 0) console.error('Personal prayer point notification reported failures', { userId: item.userId, sent: delivery.sent, failed: delivery.failed, errors: delivery.errors || [] });
          if (delivery.sent > 0) {
            await db.tx.update('prayer_reminders', [{ id: item.userId, record: { lastPersonalPrayerLocalDate: localDate } }], { patch: true });
          }
        }
      }
      if (changed) await db.tx.update('prayer_reminders', [{ id: item.userId, record: { lastSentLocalDates: sentDates, lastPrayerIndices: lastIndices } }], { patch: true });
    } catch (err) { console.error('Prayer reminder delivery failed for one account', err); }
  }
  return { statusCode: 200 };
};

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  'POST /api/voice-companion': [async (ctx) => {
    const payload = (ctx.body || {}) as { question?: string; currentReference?: string };
    const question = typeof payload.question === 'string' ? payload.question.trim() : '';
    if (!question || question.length > 1200) return error('Please enter a Bible question of up to 1,200 characters.', 400);
    try {
      const result = await ai.generate({
        system: [
          'You are the Bible study companion inside the Holy Bible King James Version app.',
          'Your first duty is to understand and answer the exact question the user asked. Do not answer a different, nearby, or generic question. Do not turn every question into a generic devotional.',
          'Use the King James Version as the primary biblical reference. Explain Scripture in its literary and historical context when relevant, and distinguish what the text explicitly says from a reasonable interpretation or application.',
          'Answer the question directly in the opening sentences. Then give a clear explanation with enough detail to be genuinely helpful. For a straightforward question, usually use about 100–180 words. For a passage explanation, theological question, or request for detail, usually use about 220–400 words. Follow the user’s requested depth rather than forcing every answer to the same length.',
          'When relevant, give 2–4 specific KJV references and explain how each one supports the answer. Use exact book, chapter, and verse references. Never invent a verse, reference, or quotation. Only put words in quotation marks as a direct KJV quotation when you are confident they are exact; otherwise paraphrase and label it as an explanation.',
          'For a question about a particular chapter or verse, focus on that passage: explain its meaning, important details, immediate context, and practical significance. For a question asking what a passage teaches, identify its main message and explain the key parts rather than giving only a one-line summary.',
          'For practical or personal questions, connect the biblical principle to the situation without pretending to know facts the user has not shared. For questions with several parts, answer each part. If the question is genuinely unclear, ask one brief clarifying question instead of guessing.',
          'If Christians hold more than one established interpretation, explain the main views fairly and say what the passage clearly states. Do not present a disputed interpretation as the only possible meaning.',
          'Be warm, natural, respectful, and easy to understand. Avoid filler, repetitive introductions, vague encouragement, and unnecessary disclaimers. Do not claim to speak for God, predict the user’s future, or replace qualified pastoral, medical, legal, or emergency support.',
          'If the question is not about the Bible, answer briefly and honestly within your ability; do not force an unrelated Bible passage into the response.',
          'If the user asks for a prayer, write a thoughtful prayer that reflects their stated request and may include relevant KJV references.'
        ].join(' '),
        prompt: [
          'The Bible reader is currently viewing ' + (payload.currentReference || 'the Bible') + '. This is only helpful context; do not assume the question is about this passage unless the user indicates that.',
          'User question: ' + question,
          'Give a relevant, accurate, sufficiently developed answer. Prioritize answering what the user actually wants to know.'
        ].join('\n\n'),
        maxTokens: 1400,
        temperature: 0.25,
        thinkingMode: 'DEEP'
      });
      return json({ answer: result.text });
    } catch (err) { console.error('Bible voice companion AI request failed', err); return error('The Bible companion is temporarily unavailable. Please try again.', 503); }
  }],
  'GET /api/prayer-reminder': [
    requireAuth(),
    async (ctx) => {
      const [reminder] = await db.get<PrayerReminder>('prayer_reminders', [ctx.user!.userId]);
      return json({ reminder: reminder || null });
    }
  ],
  'POST /api/prayer-reminder': [
    requireAuth(),
    async (ctx) => {
      const payload = (ctx.body || {}) as { schedule?: { morning?: PrayerPeriod; afternoon?: PrayerPeriod; night?: PrayerPeriod }; personalPrayerReminder?: PrayerPeriod; timezone?: string; prayerRequest?: string };
      const schedule = payload.schedule;
      const hasDailyReminder = !!schedule && ['morning', 'afternoon', 'night'].some(period => schedule[period as keyof typeof schedule]?.enabled);
      const hasPersonalReminder = payload.personalPrayerReminder?.enabled === true;
      if (hasPersonalReminder && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(payload.personalPrayerReminder?.time || '')) return error('Choose a valid time for your personal prayer-point reminder.', 400);
      for (const period of ['morning', 'afternoon', 'night'] as const) {
        const setting = schedule[period];
        if (setting?.enabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(setting.time || '')) return error('Choose a valid time for each enabled prayer period.', 400);
      }
      let timezone = typeof payload.timezone === 'string' ? payload.timezone : 'UTC';
      try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { timezone = 'UTC'; }
      const userId = ctx.user!.userId;
      const record = { userId, schedule: schedule || {}, personalPrayerReminder: payload.personalPrayerReminder || { enabled: false, time: '20:00' }, timezone, enabled: true, prayerRequest: typeof payload.prayerRequest === 'string' ? payload.prayerRequest.trim().slice(0, 1000) : '' };
      const [existing] = await db.get<PrayerReminder>('prayer_reminders', [userId]);
      if (existing) {
        const [updated] = await db.tx.update('prayer_reminders', [{ id: userId, record }], { patch: true });
        if (!updated) return error('Could not update your prayer schedule. Please try again.', 500);
      } else {
        const [created] = await db.add('prayer_reminders', [{ id: userId, ...record, lastSentLocalDates: {}, lastPrayerIndices: {} }]);
        if (!created) return error('Could not save your prayer schedule. Please try again.', 500);
      }
      return json({ ok: true, enabled: true, schedule, timezone });
    }
  ],
  'POST /api/prayer-reminder/test': [
    requireAuth(),
    async (ctx) => {
      const [savedReminder] = await db.get<PrayerReminder>('prayer_reminders', [ctx.user!.userId]);
      const result = await notifications.send({
        userIds: [ctx.user!.userId],
        notification: {
          title: 'Holy Bible KJV · Prayer reminder test',
          body: savedReminder?.prayerRequest?.trim() ? 'Your saved prayer: ' + savedReminder.prayerRequest.trim().slice(0, 150) : 'Your gentle prayer notifications are connected. Take a quiet moment with God.',
          url: '/?openPrayer=1&prayer=' + String((savedReminder as any)?.prayerIndex ?? 0) + ((savedReminder as any)?.ambientEnabled ? '&ambient=1' : '')
        },
        data: { kind: 'prayer-reminder-test' },
        ttlSeconds: 300
      });
      return json({
        sent: result.sent,
        failed: result.failed,
        errors: (result.errors || []).map(({ code, message }) => ({ code, message }))
      });
    }
  ],
  ...realtimeSubscriptionRoutes,
});