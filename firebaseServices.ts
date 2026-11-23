import { initializeApp } from 'firebase/app';
import {
  getAuth, initializeAuth, indexedDBLocalPersistence, GoogleAuthProvider, signInWithPopup, getRedirectResult,
  signInWithCredential, signOut as firebaseSignOut, type User
} from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey: 'AIzaSyBA_F7l-FI_AuZItjdprDvADAFJERRlro4',
  authDomain: 'holy-bible-kjv-1fcba.firebaseapp.com',
  projectId: 'holy-bible-kjv-1fcba',
  storageBucket: 'holy-bible-kjv-1fcba.firebasestorage.app',
  messagingSenderId: '308628864182',
  appId: '1:308628864182:android:4376b11eed054a42ebfa17'
};

const app = initializeApp(firebaseConfig);
export const firebaseAuth = Capacitor.isNativePlatform()
  ? (() => { try { return initializeAuth(app, { persistence: indexedDBLocalPersistence }); } catch { return getAuth(app); } })()
  : getAuth(app);
const firestore = getFirestore(app);
const ai = getAI(app, { backend: new GoogleAIBackend() });
const bibleModel = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });

export type AppUser = { userId: string; name?: string; email?: string };
export const toAppUser = (user: User | null): AppUser | null => user ? ({ userId: user.uid, name: user.displayName || undefined, email: user.email || undefined }) : null;

export async function finishGoogleRedirect(): Promise<AppUser | null> {
  if (!Capacitor.isNativePlatform()) {
    try { await getRedirectResult(firebaseAuth); } catch (error) { console.warn('Firebase sign-in redirect did not complete:', error); }
  }
  return toAppUser(firebaseAuth.currentUser);
}
export async function startGoogleSignIn(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const nativeResult = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
    const idToken = nativeResult.credential?.idToken;
    if (!idToken) throw new Error('Google sign-in did not return an ID token. Please try again.');
    await signInWithCredential(firebaseAuth, GoogleAuthProvider.credential(idToken));
  } else {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(firebaseAuth, provider);
  }
}
export async function signOutFirebase(): Promise<void> {
  if (Capacitor.isNativePlatform()) { try { await FirebaseAuthentication.signOut(); } catch { /* Sign out from JS auth below. */ } }
  await firebaseSignOut(firebaseAuth);
}

export type PrayerReminderData = {
  schedule: { morning: { enabled: boolean; time: string }; afternoon: { enabled: boolean; time: string }; night: { enabled: boolean; time: string } };
  personalPrayerReminder: { enabled: boolean; time: string };
  prayerRequest: string;
  timezone: string;
};
export async function loadPrayerReminder(userId: string): Promise<Partial<PrayerReminderData> | null> {
  const snapshot = await getDoc(doc(firestore, 'users', userId, 'private', 'prayerReminder'));
  return snapshot.exists() ? snapshot.data() as Partial<PrayerReminderData> : null;
}
export async function storePrayerReminder(userId: string, data: PrayerReminderData): Promise<void> {
  await setDoc(doc(firestore, 'users', userId, 'private', 'prayerReminder'), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

const notificationIds = { morning: 3101, afternoon: 3102, night: 3103, personal: 3104 };
function nextTimeTodayOrTomorrow(time: string): Date {
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date();
  date.setSeconds(0, 0);
  date.setHours(hour || 0, minute || 0, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date;
}
export async function checkLocalNotificationPermission() {
  if (!Capacitor.isNativePlatform()) return { supported: false, permission: 'unsupported' as const };
  const status = await LocalNotifications.checkPermissions();
  return { supported: true, permission: status.display };
}
export async function requestLocalNotificationPermission() {
  if (!Capacitor.isNativePlatform()) throw new Error('Daily scheduled notifications are available in the Android app, not the browser preview.');
  const current = await LocalNotifications.checkPermissions();
  const granted = current.display === 'granted' ? current : await LocalNotifications.requestPermissions();
  if (granted.display !== 'granted') throw new Error('Notifications were not allowed. Please enable them in Android settings and try again.');
}
export async function schedulePrayerReminders(data: PrayerReminderData) {
  await requestLocalNotificationPermission();
  await LocalNotifications.cancel({ notifications: Object.values(notificationIds).map(id => ({ id })) });
  const notifications = [] as Array<{ id: number; title: string; body: string; schedule: { at: Date; repeats: boolean; every: 'day' } }>;
  const reminders = [
    ['morning', notificationIds.morning, 'Morning Prayer', 'Begin your day with God. Open Holy Bible KJV for your prayer.'],
    ['afternoon', notificationIds.afternoon, 'Afternoon Prayer', 'Pause for a moment of prayer and Scripture with God.'],
    ['night', notificationIds.night, 'Evening Prayer', 'End your day with gratitude and prayer. God is with you.']
  ] as const;
  for (const [period, id, title, body] of reminders) {
    const slot = data.schedule[period];
    if (slot.enabled) notifications.push({ id, title, body, schedule: { at: nextTimeTodayOrTomorrow(slot.time), repeats: true, every: 'day' } });
  }
  if (data.personalPrayerReminder.enabled) {
    notifications.push({ id: notificationIds.personal, title: 'Your saved prayer point', body: data.prayerRequest.trim() ? `Remember to pray: ${data.prayerRequest.trim().slice(0, 160)}` : 'Take a moment to remember your personal prayer.', schedule: { at: nextTimeTodayOrTomorrow(data.personalPrayerReminder.time), repeats: true, every: 'day' } });
  }
  if (notifications.length) await LocalNotifications.schedule({ notifications });
}
export async function cancelPrayerReminders() {
  if (Capacitor.isNativePlatform()) await LocalNotifications.cancel({ notifications: Object.values(notificationIds).map(id => ({ id })) });
}
export async function askBibleCompanion(question: string, reference: string): Promise<string> {
  const prompt = `You are a gentle Bible companion inside Holy Bible KJV. Answer the user's question with humility, warmth, and practical encouragement. Ground answers in the King James Version (KJV) and clearly distinguish exact Scripture quotations from your explanation. Do not invent verse references or claim a verse says something it does not. If a question is not biblical, briefly answer helpfully and connect back to Scripture only when appropriate. Current reading: ${reference}. User question: ${question}`;
  const result = await bibleModel.generateContent(prompt);
  const answer = result.response.text().trim();
  if (!answer) throw new Error('The Bible companion returned an empty answer. Please try again.');
  return answer;
}
