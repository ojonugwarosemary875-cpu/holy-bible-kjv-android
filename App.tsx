import { useEffect, useMemo, useRef, useState } from 'react';
import { auth, api, notifications } from '@appdeploy/client';
import {
  Home, BookOpen, Search, X, ChevronRight, ChevronLeft, Bookmark,
  Volume2, Settings, Heart, Moon, Sun, Cross, Headphones, BookMarked,
  Sparkles, Play, CheckCircle2, Clock, Share2, UserCircle, Mail, LogOut
} from 'lucide-react';
import { Music2 } from 'lucide-react';
import KidsZone from './KidsZone';
import { UiLanguage } from './i18n';

type Tab = 'Home' | 'Bible' | 'Stories' | 'Prayer' | 'More';
type Verse = { verse: string; text: string };
type Chapter = { chapter: string; verses: Verse[] };
type BookData = { book: string; chapters: Chapter[] };
type VoiceRecognition = { lang: string; interimResults: boolean; onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; isFinal: boolean }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type BibleNote = { id: number; text: string; updatedAt: string };

const books = [
  'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
  '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra',
  'Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon',
  'Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos',
  'Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah',
  'Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians',
  '2 Corinthians','Galatians','Ephesians','Philippians','Colossians',
  '1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon',
  'Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'
];

const chapterCounts: Record<string, number> = {
  Genesis:50,Exodus:40,Leviticus:27,Numbers:36,Deuteronomy:34,Joshua:24,Judges:21,
  Ruth:4,'1 Samuel':31,'2 Samuel':24,'1 Kings':22,'2 Kings':25,'1 Chronicles':29,
  '2 Chronicles':36,Ezra:10,Nehemiah:13,Esther:10,Job:42,Psalms:150,Proverbs:31,
  Ecclesiastes:12,'Song of Solomon':8,Isaiah:66,Jeremiah:52,Lamentations:5,
  Ezekiel:48,Daniel:12,Hosea:14,Joel:3,Amos:9,Obadiah:1,Jonah:4,Micah:7,Nahum:3,
  Habakkuk:3,Zephaniah:3,Haggai:2,Zechariah:14,Malachi:4,Matthew:28,Mark:16,
  Luke:24,John:21,Acts:28,Romans:16,'1 Corinthians':16,'2 Corinthians':13,
  Galatians:6,Ephesians:6,Philippians:4,Colossians:4,'1 Thessalonians':5,
  '2 Thessalonians':3,'1 Timothy':6,'2 Timothy':4,Titus:3,Philemon:1,Hebrews:13,
  James:5,'1 Peter':5,'2 Peter':3,'1 John':5,'2 John':1,'3 John':1,Jude:1,Revelation:22
};

const bookCache = new Map<string, BookData>();
let bundledBiblePromise: Promise<Record<string, BookData>> | null = null;

function isValidBookData(name: string, value: unknown): value is BookData {
  if (!value || typeof value !== 'object') return false;
  const data = value as BookData;
  if (!Array.isArray(data.chapters) || data.chapters.length !== chapterCounts[name]) return false;
  return data.chapters.every(chapter =>
    Array.isArray(chapter?.verses) &&
    chapter.verses.length > 0 &&
    chapter.verses.every(verse => typeof verse?.text === 'string' && verse.text.trim().length > 0)
  );
}

async function getBundledBible(): Promise<Record<string, BookData>> {
  if (!bundledBiblePromise) {
    bundledBiblePromise = (async () => {
      const response = await fetch('./resources/kjv-bible.json.gz');
      if (!response.ok || !response.body) throw new Error('The bundled KJV Bible resource could not be loaded.');
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack the offline Bible file. Please update your browser.');
      const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
      const parsed = JSON.parse(await new Response(decompressed).text()) as Record<string, BookData>;
      if (Object.keys(parsed).length !== 66 || books.some(name => !isValidBookData(name, parsed[name]))) {
        throw new Error('The bundled Bible library is incomplete or contains a damaged book. Please refresh the app and try again.');
      }
      return parsed;
    })().catch(error => {
      bundledBiblePromise = null;
      throw error;
    });
  }
  return bundledBiblePromise;
}

const bookFile = (name: string) => name.replace(/\s+/g, '') + '.json';
const OFFLINE_DB_NAME = 'holy-bible-kjv-offline';
const OFFLINE_DB_VERSION = 1;
const OFFLINE_STORE = 'books';

function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Offline storage is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { keyPath: 'book' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open offline storage.'));
  });
}

async function readOfflineBook(name: string): Promise<BookData | null> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(OFFLINE_STORE, 'readonly').objectStore(OFFLINE_STORE).get(name);
    request.onsuccess = () => { db.close(); resolve((request.result as BookData | undefined) || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function saveOfflineBook(data: BookData): Promise<void> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OFFLINE_STORE, 'readwrite');
    transaction.objectStore(OFFLINE_STORE).put(data);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Could not save this book offline.')); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Offline saving was interrupted.')); };
  });
}

async function getOfflineBookNames(): Promise<string[]> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(OFFLINE_STORE, 'readonly').objectStore(OFFLINE_STORE).getAll();
    request.onsuccess = () => {
      db.close();
      const records = request.result as BookData[];
      resolve(books.filter(name => records.some(record => isValidBookData(name, record))));
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function loadBook(name: string): Promise<BookData> {
  const cached = bookCache.get(name);
  if (cached && isValidBookData(name, cached)) return cached;
  bookCache.delete(name);
  try {
    const offlineBook = await readOfflineBook(name);
    if (isValidBookData(name, offlineBook)) {
      bookCache.set(name, offlineBook);
      return offlineBook;
    }
  } catch {
    // Continue to the bundled library when local storage is unavailable.
  }
  try {
    const bundled = await getBundledBible();
    const bundledBook = bundled[name];
    if (isValidBookData(name, bundledBook)) {
      bookCache.set(name, bundledBook);
      try { await saveOfflineBook(bundledBook); } catch { /* The bundled resource remains available through the app cache. */ }
      return bundledBook;
    }
  } catch {
    // Fall back to the existing online source when the bundled resource is unavailable.
  }
  if (!navigator.onLine) {
    throw new Error(name + ' is not available offline yet. Reconnect once to prepare the complete Bible library.');
  }
  const response = await fetch(
    'https://raw.githubusercontent.com/aruljohn/Bible-kjv/master/' + encodeURIComponent(bookFile(name))
  );
  if (!response.ok) throw new Error('The KJV text could not be loaded. Please check your internet connection and try again.');
  const data = await response.json() as BookData;
  if (!data.chapters || !Array.isArray(data.chapters)) throw new Error('The Bible text source returned an unexpected format.');
  bookCache.set(name, data);
  try { await saveOfflineBook(data); } catch { /* Reading still works when storage is unavailable. */ }
  return data;
}

const stories = [
  { title:'Creation', ref:'Genesis 1', text:'God created the heaven and the earth and made all things.' },
  { title:'Noah and the Ark', ref:'Genesis 6', text:'Noah trusted God and followed His instructions.' },
  { title:'Moses and the Exodus', ref:'Exodus 14', text:'God made a way for His people through the sea.' },
  { title:'David and Goliath', ref:'1 Samuel 17', text:'David trusted the LORD when he faced Goliath.' },
  { title:'Daniel in the Lions’ Den', ref:'Daniel 6', text:'Daniel continued to pray and trusted God.' },
  { title:'The Birth of Jesus', ref:'Luke 2', text:'Jesus was born in Bethlehem.' },
  { title:'The Good Samaritan', ref:'Luke 10', text:'Jesus taught us to show mercy to our neighbour.' },
  { title:'The Resurrection', ref:'John 20', text:'Jesus rose from the dead.' }
];


const prayerOptions = [
  { title:'Bedtime Prayer', intro:'End the day in God’s presence. Lay down every burden and rest in His faithful care.', verse:'Psalm 4:8', scripture:'I will both lay me down in peace, and sleep: for thou, LORD, only makest me dwell in safety.', text:'Heavenly Father, as this day comes to an end, I come before You just as I am. You have seen every moment of this day: the things that brought me joy, the things that wounded me, the words I wish I could take back, and the burdens I have struggled to carry. Thank You for keeping me, providing for me, and showing me mercy even in the moments when I was not mindful of Your goodness.\n\nLord, forgive me for the ways I have fallen short today. Search my heart and reveal anything in me that does not please You. Wash away bitterness, pride, anger, fear, and every anxious thought. Where I have hurt someone, teach me to make things right. Where someone has hurt me, give me grace to forgive without pretending that pain does not matter.\n\nI place my family, my friends, my home, and every concern about tomorrow into Your hands. Watch over those who are sick, lonely, grieving, afraid, or far from home. Give comfort to the troubled and strength to those who feel they cannot go on. Let Your presence fill this room and let Your peace quiet my mind. If I wake during the night, remind me that I am never outside Your care. I do not know what tomorrow holds, but I know You are already there. I surrender this night to You, trusting in Your unfailing love. In the name of Jesus Christ, Amen.' },
  { title:'Morning Prayer', intro:'Give the first moments of your day to the Lord and ask Him to direct your steps.', verse:'Lamentations 3:22–23', scripture:'It is of the LORD’S mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness.', text:'Gracious Father, thank You for waking me to see another day. Before I turn to my responsibilities, my plans, or the noise of the world, I turn my heart towards You. Thank You that Your mercy has not run out, that Your compassion is new this morning, and that my life is held in Your hands.\n\nLord, order my steps today. Let my thoughts be pleasing to You, let my words bring life rather than harm, and let my actions show the love of Christ. Give me discernment when I must make decisions, patience when things do not go as planned, humility when I am corrected, and courage when doing what is right is difficult. Keep me from temptation, careless speech, jealousy, and the desire to please people at the expense of obeying You.\n\nRemember those I love. Provide for families facing hardship, comfort those carrying silent pain, guide those who feel lost, and strengthen everyone who is weary. Make me attentive to opportunities to serve and generous with the blessings You place in my hands. When challenges come, keep me from fear. When success comes, keep me from pride. May this day honour You in the ordinary things as well as the great things. I commit every hour to You, in Jesus’ mighty name, Amen.' },
  { title:'Prayer for Courage', intro:'Bring your fears honestly before God and ask for strength to obey Him.', verse:'Joshua 1:9', scripture:'Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.', text:'Almighty God, You know the fears I rarely speak aloud. You know the uncertainty before me, the responsibilities that feel too heavy, and the moments when I question whether I have the strength to continue. I confess that sometimes fear has been louder than my faith. Forgive me for allowing what I cannot control to take the place of trust in You.\n\nFather, teach me what true courage looks like. It is not pretending that I am never afraid; it is choosing to follow You even when I tremble. Remind me that Your presence does not depend on my circumstances. When I face opposition, be my strength. When I must begin again, give me perseverance. When I must speak truth, give me wisdom and boldness. When the way ahead is unclear, give me enough light for the next faithful step.\n\nGuard my heart from despair and keep me from making decisions out of panic. Help me remember the times You have carried me before. Let Your Word become stronger in my heart than every voice telling me to give up. I place the outcome in Your hands and ask for grace to remain faithful, whatever the outcome may be. In Jesus’ name, Amen.' },
  { title:'Prayer for Peace', intro:'Be still before God. Give Him the thoughts and worries that have troubled your heart.', verse:'Philippians 4:6–7', scripture:'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God. And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.', text:'Father of mercies, I come to You with a mind that is sometimes restless and a heart that can become overwhelmed. You know every concern I am carrying: the problems I can explain and the ones I cannot put into words. I do not want worry to rule my thoughts or fear to decide my actions. I bring these burdens to You, not because I have all the answers, but because You are faithful and Your wisdom is greater than mine.\n\nPlease quiet the noise within me. Help me distinguish between what I can responsibly do and what I must entrust to You. Give me patience to wait, courage to act when it is time, and grace to accept what I cannot change. Where there is conflict, guide me towards truth and reconciliation. Where there is grief, sit with me in my sorrow. Where there is uncertainty, remind me that Your character does not change.\n\nLet the peace of Christ guard my heart and mind. Keep me from returning again and again to thoughts that steal my rest. Teach me to pray before I panic, to give thanks even while I wait, and to remember Your goodness in every season. I place this day, this situation, and my future in Your hands. In Jesus’ name, Amen.' },
  { title:'Prayer of Repentance', intro:'Come before God honestly, asking for forgiveness and a renewed heart.', verse:'Psalm 51:10', scripture:'Create in me a clean heart, O God; and renew a right spirit within me.', text:'Holy and merciful God, I come before You without excuses. You know my heart completely, including the thoughts, motives, and actions I try to hide from others. I confess the ways I have sinned against You and against people. Forgive my pride, selfishness, impatience, dishonesty, resentment, and every time I have chosen my own way instead of Yours.\n\nI am sorry not only for the consequences of my sin, but because it grieves Your heart. Please cleanse me and create in me a clean heart. Renew a right spirit within me. Teach me to hate what is evil and love what is good. Where I need to apologise, give me humility. Where I need to change my habits, give me discipline. Where I have caused harm, show me how to take responsibility and make amends as far as I am able.\n\nThank You that Your mercy calls me to return to You. Do not let me use forgiveness as an excuse to continue in sin. By Your Spirit, help me walk in obedience, truth, and love. Restore the joy of Your salvation and make my life a testimony of Your transforming grace. I ask this through Jesus Christ, my Lord and Saviour, Amen.' },
  { title:'Prayer for Healing', intro:'Ask the Lord for healing, comfort, wisdom, and strength in a difficult season.', verse:'Psalm 147:3', scripture:'He healeth the broken in heart, and bindeth up their wounds.', text:'Loving Father, I bring before You my need for healing. You know the pain in my body, the weariness in my mind, and the wounds in my heart. Nothing about my suffering is hidden from You. Please draw near to me in this difficult season. Grant healing according to Your mercy, relief where there is pain, strength where there is weakness, and comfort where there is sorrow.\n\nGuide the hands and minds of those caring for the sick. Give wisdom to doctors and caregivers, provide what is needed, and sustain families who are worried and exhausted. When healing takes time, give patience for each day. When answers are uncertain, keep hope alive. Help me receive support without shame and remind me that asking for help is not a failure of faith.\n\nLord, heal the wounds that cannot be seen as well as those that can. Mend broken relationships where reconciliation is possible. Bring light into places of grief, shame, and loneliness. Whatever this season holds, do not let suffering convince me that I have been abandoned. Hold me close and help me take the next step with You. In Jesus’ name, Amen.' },
  { title:'Prayer for Protection', intro:'Entrust your home, loved ones, journeys, and decisions to God’s care.', verse:'Psalm 121:7–8', scripture:'The LORD shall preserve thee from all evil: he shall preserve thy soul. The LORD shall preserve thy going out and thy coming in from this time forth, and even for evermore.', text:'Lord God, my refuge and my strong tower, I place myself and those I love under Your care. Watch over our homes, our journeys, our work, our studies, and every place our feet may carry us. Protect us from danger, deception, violence, and decisions that would lead us away from Your truth. Give us wisdom to act carefully and not to mistake recklessness for faith.\n\nGuard our minds from lies and our hearts from hatred. Keep our families in love and understanding. Where there is tension, bring patience; where there is temptation, provide a way to stand firm; where there is vulnerability, send trustworthy help. Remember those who must travel, those who work through the night, and those who live in places of danger.\n\nI know that life is not free from hardship, but I trust that nothing can separate Your children from Your love in Christ. Give me courage without carelessness and confidence without pride. Let my life be guided by Your wisdom and my soul rest in Your keeping. In Jesus’ name, Amen.' },
  { title:'Prayer of Gratitude', intro:'Pause to recognise God’s goodness in both the great and ordinary gifts of life.', verse:'1 Thessalonians 5:18', scripture:'In every thing give thanks: for this is the will of God in Christ Jesus concerning you.', text:'Heavenly Father, I pause to thank You. Forgive me for the times I have been so focused on what is missing that I have overlooked the gifts already surrounding me. Thank You for life, for breath, for strength to rise again, for the people who care for me, and for the help You have provided in ways I did not always recognise.\n\nThank You for answered prayers and for the patience You teach me while I wait. Thank You for lessons learned through difficult seasons, for comfort in sorrow, and for the hope I have through Jesus Christ. I do not thank You because every circumstance is easy or because pain is not real. I thank You because You remain good and faithful in every circumstance.\n\nOpen my eyes to see the needs of others. Make me generous with my time, gentle with my words, and faithful with what You have entrusted to me. Keep me from taking blessings for granted or measuring my life against someone else’s. May gratitude shape the way I live, not only the words I speak. Receive my thanks and let my life bring honour to You. In Jesus’ name, Amen.' }
];

const concisePrayerTexts = [
  'Heavenly Father, thank You for carrying me through today. Forgive my mistakes, protect the people I love, and quiet my heart as I rest. I place tomorrow in Your hands. In Jesus’ name, Amen.',
  'Gracious Father, thank You for the gift of a new day. Guide my steps, guard my words, and fill my heart with love and courage. Let my life honour You today. In Jesus’ name, Amen.',
  'Lord, You know what I am facing and the fears I carry. Give me courage to keep going, faith when the road is hard, and strength to do what is right. Stay close to me. In Jesus’ name, Amen.',
  'Father, You know every worry in my heart. Quiet my thoughts, carry what feels too heavy, and fill me with Your peace. Help me trust You one step at a time. In Jesus’ name, Amen.',
  'Merciful Father, forgive me for the ways I have fallen short. Cleanse my heart, renew my spirit, and help me choose what is right. Thank You for never turning away a repentant heart. In Jesus’ name, Amen.',
  'Loving Father, You see my pain and every hidden wound. Please bring healing, comfort and strength. Guide those who care for me, and remind me that I am not alone. In Jesus’ name, Amen.',
  'Lord, watch over me and those I love. Keep us safe, guide our choices, and lead us away from harm. Let Your wisdom and love surround our home. In Jesus’ name, Amen.',
  'Heavenly Father, thank You for life, love, and every blessing, seen and unseen. Keep my heart grateful and make me a blessing to someone today. All glory belongs to You. In Jesus’ name, Amen.'
];

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [account, setAccount] = useState<{ userId: string; name?: string; email?: string } | null>(null);
  const [profileName, setProfileName] = useState(() => { try { return localStorage.getItem('kjv-profile-name') || ''; } catch { return ''; } });
  const [customDisplayName, setCustomDisplayName] = useState(() => { try { return localStorage.getItem('kjv-custom-display-name') || ''; } catch { return ''; } });
  const [editingProfileName, setEditingProfileName] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const [namePromptMode, setNamePromptMode] = useState<'guest' | 'signin'>('guest');
  const [authMessage, setAuthMessage] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('Home');
  const [book, setBook] = useState('Genesis');
  const [chapter, setChapter] = useState(1);
  const [bookData, setBookData] = useState<BookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [allSearchResults, setAllSearchResults] = useState<{ reference: string; text: string; book: string; chapter: number }[]>([]);
  const [searchingAll, setSearchingAll] = useState(false);
  const [searchedAll, setSearchedAll] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [font, setFont] = useState(17);
  const [prayer, setPrayer] = useState(false);
  const [selectedPrayer, setSelectedPrayer] = useState(0);
  const [prayerCompleted, setPrayerCompleted] = useState(false);

  const [prayerSchedule, setPrayerSchedule] = useState<{ morning: { enabled: boolean; time: string }; afternoon: { enabled: boolean; time: string }; night: { enabled: boolean; time: string } }>(() => { try { const saved = JSON.parse(localStorage.getItem('kjv-prayer-schedule') || 'null'); return saved || { morning: { enabled: true, time: '07:00' }, afternoon: { enabled: true, time: '13:00' }, night: { enabled: true, time: '21:00' } }; } catch { return { morning: { enabled: true, time: '07:00' }, afternoon: { enabled: true, time: '13:00' }, night: { enabled: true, time: '21:00' } }; } });
  const [prayerRequest, setPrayerRequest] = useState(() => { try { return localStorage.getItem('kjv-prayer-request') || ''; } catch { return ''; } });
  const [prayerRequestSaved, setPrayerRequestSaved] = useState(false);
  const [personalPrayerReminder, setPersonalPrayerReminder] = useState<{ enabled: boolean; time: string }>(() => { try { return JSON.parse(localStorage.getItem('kjv-personal-prayer-reminder') || 'null') || { enabled: false, time: '20:00' }; } catch { return { enabled: false, time: '20:00' }; } });
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderStatus, setReminderStatus] = useState('');
  const [reminderGuidance, setReminderGuidance] = useState<{ kind: string; title: string; message: string; steps: string[] } | null>(null);
  const [showNotificationSetup, setShowNotificationSetup] = useState(false);
  const [showOpeningPrayerPrompt, setShowOpeningPrayerPrompt] = useState(false);
  const [selectedScripture, setSelectedScripture] = useState<{ reference: string; text: string } | null>(() => {
    try { const saved = localStorage.getItem('kjv-prayer-scripture'); return saved ? JSON.parse(saved) as { reference: string; text: string } : null; } catch { return null; }
  });
  const [scripturePickerOpen, setScripturePickerOpen] = useState(false);
  const [scriptureBook, setScriptureBook] = useState('Psalms');
  const [scriptureChapter, setScriptureChapter] = useState(23);
  const [scriptureBookData, setScriptureBookData] = useState<BookData | null>(null);
  const [scriptureLoading, setScriptureLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [kidsZoneOpen, setKidsZoneOpen] = useState(false);
  const [bibleNotes, setBibleNotes] = useState<BibleNote[]>(() => { try { return JSON.parse(localStorage.getItem('kjv-bible-notes') || '[]') as BibleNote[]; } catch { return []; } });
  const [noteDraft, setNoteDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [notesListening, setNotesListening] = useState(false);
  const [notesStatus, setNotesStatus] = useState('');
  const notesRecognition = useRef<VoiceRecognition | null>(null);
  const [selectedCountry, setSelectedCountry] = useState(() => { try { return localStorage.getItem('kjv-country') || 'Nigeria'; } catch { return 'Nigeria'; } });
  const [selectedLanguage, setSelectedLanguage] = useState(() => { try { return localStorage.getItem('kjv-language') || 'English'; } catch { return 'English'; } });
  const [selectedStory, setSelectedStory] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceQuestion, setVoiceQuestion] = useState('');
  const [voiceAnswer, setVoiceAnswer] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState('');
  const voiceRecognition = useRef<VoiceRecognition | null>(null);
  const [offlineBookCount, setOfflineBookCount] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadingBible, setDownloadingBible] = useState(false);
  const [offlineMessage, setOfflineMessage] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;
    const refreshOfflineCount = () => getOfflineBookNames().then(names => {
      if (active) setOfflineBookCount(names.length);
    }).catch(() => {
      if (active) setOfflineMessage('This browser could not open offline storage.');
    });
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    refreshOfflineCount();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const downloadCompleteBible = async () => {
    setDownloadingBible(true);
    setDownloadProgress(0);
    setOfflineMessage('Preparing all 66 books from the Bible library included with the app…');
    try {
      const bundled = await getBundledBible();
      for (let index = 0; index < books.length; index += 1) {
        const name = books[index];
        const data = bundled[name];
        await saveOfflineBook(data);
        bookCache.set(name, data);
        const completed = index + 1;
        setOfflineBookCount(completed);
        setDownloadProgress(Math.round((completed / books.length) * 100));
      }
      setOfflineBookCount(books.length);
      setDownloadProgress(100);
      setOfflineMessage('Your complete 66-book KJV Bible is saved on this device and ready for offline reading.');
    } catch (err) {
      setOfflineMessage(err instanceof Error ? err.message : 'The offline Bible library could not be prepared. Please try again while connected.');
      try { setOfflineBookCount((await getOfflineBookNames()).length); } catch { /* Keep the last known count. */ }
    } finally {
      setDownloadingBible(false);
    }
  };

  useEffect(() => {
    let active = true;
    getOfflineBookNames().then(names => {
      if (active && names.length < books.length) void downloadCompleteBible();
      else if (active) {
        setOfflineBookCount(names.length);
        setDownloadProgress(100);
      }
    }).catch(() => {
      if (active) void downloadCompleteBible();
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    auth.getUser().then(user => {
      if (active) {
        setAccount(user ? { userId: user.userId, name: user.name, email: user.email } : null);
        if (user) {
          setShowSplash(false);
          api.get('/api/prayer-reminder').then(({ data }) => {
            setReminderEnabled(Boolean(data?.reminder?.enabled));
            if (data?.reminder?.time) (window as any).setReminderTime?.(data.reminder.time);
            (window as any).setReminderAmbient?.(Boolean(data?.reminder?.ambientEnabled));
            if (Number.isInteger(data?.reminder?.prayerIndex)) setSelectedPrayer(Math.max(0, Math.min(prayerOptions.length - 1, data.reminder.prayerIndex)));
          }).catch(() => setReminderStatus('Sign-in is ready, but your saved reminder could not be loaded yet.'));
        } else {
          setReminderEnabled(false);
        }
        if (user?.name) {
          setProfileName(user.name);
          try { localStorage.setItem('kjv-profile-name', user.name); } catch { /* Keep the name in memory for this session. */ }
        }
        setAuthChecked(true);
      }
    }).catch(() => {
      if (active) {
        setAuthMessage('Account status could not be checked. You can try signing in again.');
        setAuthChecked(true);
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (showSplash) return;
    try {
      if (localStorage.getItem('kjv-prayer-reminders-onboarded') !== 'yes' && localStorage.getItem('kjv-prayer-reminders-onboarded') !== 'dismissed') setShowNotificationSetup(true);
    } catch { setShowNotificationSetup(true); }
    const params = new URLSearchParams(window.location.search); if (params.get('openPrayerPoint') === '1') {
        setTab('Prayer');
        params.delete('openPrayerPoint');
        const remainingPointParams = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (remainingPointParams ? '?' + remainingPointParams : '') + window.location.hash);
        return;
      }
      ;if (params.get('openPrayer') !== '1') return;
    const requestedPrayer = Number(params.get('prayer') || 0);
    const safePrayer = Number.isInteger(requestedPrayer) && requestedPrayer >= 0 && requestedPrayer < prayerOptions.length ? requestedPrayer : 0;
    setSelectedPrayer(safePrayer);
    setPrayerCompleted(false);
    setPrayer(true);
    setTab('Prayer');
    params.delete('ambient');
    params.delete('openPrayer');
    params.delete('prayer');
    const remaining = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (remaining ? '?' + remaining : '') + window.location.hash);
  }, [showSplash]);

  useEffect(() => {
    if (showSplash || showNotificationSetup || prayer || namePromptOpen) return;
    try {
      const reminderSetup = localStorage.getItem('kjv-prayer-reminders-onboarded');
      if (reminderSetup !== 'yes' && reminderSetup !== 'dismissed') return;
      if (sessionStorage.getItem('kjv-opening-prayer-shown') === 'yes') return;
      sessionStorage.setItem('kjv-opening-prayer-shown', 'yes');
    } catch { /* Show the invitation once for this app session. */ }
    setShowOpeningPrayerPrompt(true);
  }, [showSplash, showNotificationSetup, prayer, namePromptOpen]);

  const startSignIn = async () => {
    setAuthMessage('');
    try {
      await auth.signInWithRedirect();
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : 'Unable to open sign-in. Please try again.');
    }
  };

  const signOut = async () => {
    try {
      await auth.signOut();
      setAccount(null);
      setReminderEnabled(false);
      setAuthMessage('You have signed out.');
    } catch {
      setAuthMessage('Unable to sign out right now. Please try again.');
    }
  };

  useEffect(() => {
    if (!account) return;
    let active = true;
    api.get('/api/prayer-reminder').then(({ data }) => {
      const saved = data?.reminder?.schedule;
      if (!active || !saved) return;
      const dailyEnabled = ['morning', 'afternoon', 'night'].some(period => saved[period]?.enabled === true);
      const next = {
        morning: { enabled: dailyEnabled, time: '07:00' },
        afternoon: { enabled: dailyEnabled, time: '13:00' },
        night: { enabled: dailyEnabled, time: '21:00' }
      };
      setPrayerSchedule(next);
      setReminderEnabled(true);
      const savedPointReminder = data?.reminder?.personalPrayerReminder;
      if (savedPointReminder) {
        const pointReminder = { enabled: savedPointReminder.enabled === true, time: /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(savedPointReminder.time || '') ? savedPointReminder.time : '20:00' };
        setPersonalPrayerReminder(pointReminder);
        try { localStorage.setItem('kjv-personal-prayer-reminder', JSON.stringify(pointReminder)); } catch { /* Server copy remains saved. */ }
      }
      if (typeof data?.reminder?.prayerRequest === 'string' && data.reminder.prayerRequest) setPrayerRequest(data.reminder.prayerRequest);
      try { localStorage.setItem('kjv-prayer-schedule', JSON.stringify(next)); } catch { /* Server copy remains saved. */ }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [account]);

  const activateAutomaticPrayerReminders = async () => {
    if (!account) {
      await startSignIn();
      return;
    }
    if (!navigator.onLine) { setReminderStatus('Connect to the internet to set up automatic prayer reminders.'); return; }
    setReminderBusy(true);
    setReminderStatus('');
    try {
      const environment = await notifications.getEnvironment();
      if (!environment.isSupported || environment.permission === 'denied') {
        const guidance = await notifications.getEnableGuidance();
        setReminderGuidance(guidance);
        setReminderStatus(environment.permission === 'denied' ? 'Notifications are blocked on this device. Allow them in your phone settings, then try again.' : 'This browser does not support push notifications. You can still use the Bible and opening prayer.');
        return;
      }
      await notifications.subscribe({ showUi: false });
      const confirmed = await notifications.getEnvironment();
      if (confirmed.permission !== 'granted') { setReminderStatus('Notification permission was not granted. You can try again later.'); return; }
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const automaticSchedule = { morning: { enabled: true, time: '07:00' }, afternoon: { enabled: true, time: '13:00' }, night: { enabled: true, time: '21:00' } };
      await api.post('/api/prayer-reminder', { schedule: automaticSchedule, personalPrayerReminder, timezone, prayerRequest: prayerRequest.trim() });
      setPrayerSchedule(automaticSchedule);
      setReminderEnabled(true);
      setShowNotificationSetup(false);
      setReminderGuidance(null);
      try { localStorage.setItem('kjv-prayer-schedule', JSON.stringify(automaticSchedule)); localStorage.setItem('kjv-prayer-reminders-onboarded', 'yes'); } catch { /* Server remains the saved source. */ }
      setReminderStatus('Your morning, afternoon and night prayer reminders are now set up automatically.');
    } catch (err) {
      setReminderStatus(err instanceof Error ? err.message : 'Prayer reminders could not be enabled. Please try again.');
      try { setReminderGuidance(await notifications.getEnableGuidance()); } catch { /* Keep the error visible. */ }
    } finally { setReminderBusy(false); }
  };

  const saveEnabledPrayerReminder = async () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    if (!Object.values(prayerSchedule).some(period => period.enabled) && !personalPrayerReminder.enabled) {
      setReminderStatus('Turn on at least one prayer reminder before saving.');
      return;
    }
    await api.post('/api/prayer-reminder', { schedule: prayerSchedule, personalPrayerReminder, timezone, prayerRequest: prayerRequest.trim() });
    try { localStorage.setItem('kjv-prayer-schedule', JSON.stringify(prayerSchedule)); } catch { /* The server remains the saved source for signed-in reminders. */ }
    setReminderEnabled(true);
    setReminderGuidance(null);
    setReminderStatus('Your automatic morning, afternoon and night prayer notifications are saved. The app manages the schedule for you.');
  };

  const enablePrayerReminder = async () => {
    if (!account) {
      setReminderStatus('Please sign in to enable prayer-time notifications.');
      openNamePrompt('signin');
      return;
    }
    if (!navigator.onLine) {
      setReminderStatus('Connect to the internet to enable or update your prayer reminder.');
      return;
    }
    setReminderBusy(true);
    setReminderStatus('');
    try {
      const environment = await notifications.getEnvironment();
      const guidance = await notifications.getEnableGuidance();
      if (!environment.isSupported || guidance.kind === 'unsupported') {
        setReminderGuidance(guidance);
        setReminderStatus('Notifications are not supported in this browser or app mode. Try opening Holy Bible KJV in Chrome or installing it on your phone.');
        return;
      }
      if (environment.permission === 'denied' || guidance.kind === 'permission_denied') {
        setReminderGuidance(guidance);
        setReminderStatus('Notifications are blocked for Holy Bible KJV. Follow the steps below to allow them, then try again.');
        return;
      }
      if (environment.permission === 'default') {
        setReminderGuidance({
          kind: 'permission_prompt',
          title: 'Allow prayer reminders?',
          message: 'Holy Bible KJV would like to send a gentle notification at your chosen prayer time. Android will ask you to allow notifications next.',
          steps: ['Tap Continue below.', 'When your phone asks, choose Allow.', 'Return here and your daily prayer reminder will be saved.']
        });
        return;
      }
      await notifications.subscribe({ showUi: false });
      await saveEnabledPrayerReminder();
    } catch (err) {
      setReminderStatus(err instanceof Error ? err.message : 'Could not check notification permission. Please try again.');
    } finally {
      setReminderBusy(false);
    }
  };

  const confirmPrayerNotificationPermission = async () => {
    if (!account || !navigator.onLine) {
      setReminderStatus('Please sign in and connect to the internet before enabling your prayer reminder.');
      return;
    }
    setReminderBusy(true);
    setReminderStatus('');
    try {
      const environment = await notifications.getEnvironment();
      if (!environment.isSupported) {
        const guidance = await notifications.getEnableGuidance();
        setReminderGuidance(guidance);
        setReminderStatus(guidance.message);
        return;
      }
      if (environment.permission === 'denied') {
        const guidance = await notifications.getEnableGuidance();
        setReminderGuidance(guidance);
        setReminderStatus('Notifications are still blocked. Enable them in your phone or browser settings, then tap Try again.');
        return;
      }
      if (environment.permission === 'default') {
        await notifications.subscribe({ showUi: false });
      } else {
        await notifications.subscribe({ showUi: false });
      }
      const confirmed = await notifications.getEnvironment();
      if (confirmed.permission !== 'granted') {
        const guidance = await notifications.getEnableGuidance();
        setReminderGuidance(guidance);
        setReminderStatus('Permission has not been granted yet. Follow the instructions and try again.');
        return;
      }
      await saveEnabledPrayerReminder();
    } catch (err) {
      setReminderStatus(err instanceof Error ? err.message : 'Permission was not completed. Please try again.');
      try {
        const guidance = await notifications.getEnableGuidance();
        setReminderGuidance(guidance);
      } catch { /* Keep the actionable error message visible. */ }
    } finally {
      setReminderBusy(false);
    }
  };

  const saveBibleNote = () => {
    const cleanText = noteDraft.trim();
    if (!cleanText) { setNotesStatus('Write or dictate a note before saving.'); return; }
    const next = editingNoteId === null
      ? [{ id: Date.now(), text: cleanText, updatedAt: new Date().toISOString() }, ...bibleNotes]
      : bibleNotes.map(note => note.id === editingNoteId ? { ...note, text: cleanText, updatedAt: new Date().toISOString() } : note);
    try {
      localStorage.setItem('kjv-bible-notes', JSON.stringify(next));
      setBibleNotes(next);
      setNoteDraft('');
      setEditingNoteId(null);
      setNotesStatus('Your Bible note is saved on this device.');
    } catch {
      setNotesStatus('This note could not be saved. Check available device storage.');
    }
  };

  const startNotesDictation = () => {
    const recognitionWindow = window as unknown as { SpeechRecognition?: new () => VoiceRecognition; webkitSpeechRecognition?: new () => VoiceRecognition };
    const Recognition = recognitionWindow.SpeechRecognition || recognitionWindow.webkitSpeechRecognition;
    if (!Recognition) { setNotesStatus('Voice typing is not supported by this browser. You can still type your note.'); return; }
    try {
      const recognition = new Recognition();
      recognition.lang = selectedLanguage === 'Spanish' ? 'es-ES' : selectedLanguage === 'French' ? 'fr-FR' : 'en-NG';
      recognition.interimResults = true;
      recognition.onresult = event => {
        const finalized = Array.from(event.results)
          .slice(event.resultIndex)
          .filter(result => result[0]?.isFinal)
          .map(result => result[0]?.transcript?.trim() || '')
          .filter(Boolean);
        if (finalized.length) {
          const addition = finalized.join(' ');
          setNoteDraft(current => current.trimEnd() ? `${current.trimEnd()} ${addition}` : addition);
        }
      };
      recognition.onerror = () => { setNotesListening(false); setNotesStatus('Microphone access was interrupted. Check browser microphone permission and try again.'); };
      recognition.onend = () => setNotesListening(false);
      notesRecognition.current = recognition;
      recognition.start();
      setNotesListening(true);
      setNotesStatus('Listening. Speak your Bible note, then tap Stop dictation to review it.');
    } catch {
      setNotesListening(false);
      setNotesStatus('The microphone could not start. Check browser permission and try again.');
    }
  };

  const stopNotesDictation = () => { notesRecognition.current?.stop(); setNotesListening(false); };

  const removeBibleNote = (id: number) => {
    const next = bibleNotes.filter(note => note.id !== id);
    try { localStorage.setItem('kjv-bible-notes', JSON.stringify(next)); setBibleNotes(next); } catch { setNotesStatus('This note could not be removed.'); }
  };

  const savePrayerJournal = async () => {
    try {
      localStorage.setItem('kjv-prayer-request', prayerRequest);
      localStorage.setItem('kjv-prayer-schedule', JSON.stringify(prayerSchedule));
      localStorage.setItem('kjv-personal-prayer-reminder', JSON.stringify(personalPrayerReminder));
      if (selectedScripture) localStorage.setItem('kjv-prayer-scripture', JSON.stringify(selectedScripture));
      else localStorage.removeItem('kjv-prayer-scripture');
      setPrayerRequestSaved(true);
      if (account && reminderEnabled && navigator.onLine) {
        try {
          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
          await api.post('/api/prayer-reminder', { schedule: prayerSchedule, personalPrayerReminder, timezone, prayerRequest: prayerRequest.trim() });
          setReminderStatus('Your prayer is saved and your morning, afternoon and night reminder schedule has been updated.');
        } catch {
          setReminderStatus('Your prayer is saved on this device, but the scheduled reminder could not be updated. Tap Update prayer notification when you are online.');
        }
      }
    } catch {
      setPrayerRequestSaved(false);
      setReminderStatus('Your prayer could not be saved on this device. Check available storage.');
    }
  };

  useEffect(() => {
    if (!scripturePickerOpen) return;
    let active = true;
    setScriptureLoading(true);
    loadBook(scriptureBook).then(data => {
      if (active) setScriptureBookData(data);
    }).catch(() => {
      if (active) setScriptureBookData(null);
    }).finally(() => {
      if (active) setScriptureLoading(false);
    });
    return () => { active = false; };
  }, [scripturePickerOpen, scriptureBook]);

  const openNamePrompt = (mode: 'guest' | 'signin') => {
    setNamePromptMode(mode);
    setNameDraft(account?.name || profileName);
    setNamePromptOpen(true);
  };

  const continueWithName = async () => {
    const cleanName = nameDraft.trim();
    if (!cleanName) return;
    setProfileName(cleanName);
    try { localStorage.setItem('kjv-profile-name', cleanName); } catch { /* Keep the name in memory for this session. */ }
    setNamePromptOpen(false);
    if (namePromptMode === 'signin') {
      await startSignIn();
      return;
    }
    setShowSplash(false);
    setPrayer(false);
    setPrayerCompleted(false);
    setTab('Bible');
    setBook('Genesis');
    setChapter(1);
    setError('');
  };

  const saveProfileDisplayName = () => {
    const cleanName = profileNameDraft.trim();
    if (!cleanName) return;
    try {
      localStorage.setItem('kjv-custom-display-name', cleanName);
      setCustomDisplayName(cleanName);
      setEditingProfileName(false);
      setAuthMessage('Your Holy Bible display name has been saved. Your Google account name and email are unchanged.');
    } catch {
      setAuthMessage('Your display name could not be saved on this device. Please check available storage and try again.');
    }
  };

  const continueAsGuestWithoutName = () => {
    setProfileName('');
    try { localStorage.removeItem('kjv-profile-name'); } catch { /* Continue without local name storage. */ }
    setNamePromptOpen(false);
    setShowSplash(false);
    setPrayer(false);
    setPrayerCompleted(false);
    setTab('Bible');
    setBook('Genesis');
    setChapter(1);
    setError('');
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    loadBook(book).then(data => {
      if (active) setBookData(data);
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : 'Unable to load this Bible book.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [book]);

  const currentChapter = bookData?.chapters.find(item => Number(item.chapter) === chapter);
  const currentVerses = currentChapter?.verses ?? [];
  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term || !bookData) return [];
    return bookData.chapters.flatMap(ch => ch.verses
      .filter(v => v.text.toLowerCase().includes(term))
      .map(v => ({ reference: bookData.book + ' ' + ch.chapter + ':' + v.verse, text: v.text, chapter: Number(ch.chapter) })))
      .slice(0, 80);
  }, [query, bookData]);

  const goToBible = (nextBook = book, nextChapter = 1) => {
    setBook(nextBook);
    setChapter(Math.min(chapterCounts[nextBook] || 1, Math.max(1, nextChapter)));
    setTab('Bible');
    setSearchOpen(false);
    setSelectedStory(null);
  };

  const searchEntireBible = async () => {
    const term = query.trim().toLowerCase();
    if (!term) return;
    setSearchingAll(true);
    setSearchedAll(false);
    setAllSearchResults([]);
    try {
      const matches: { reference: string; text: string; book: string; chapter: number }[] = [];
      for (let start = 0; start < books.length; start += 6) {
        const batch = await Promise.all(books.slice(start, start + 6).map(name => loadBook(name)));
        for (const data of batch) {
          for (const ch of data.chapters) {
            for (const verse of ch.verses) {
              if (verse.text.toLowerCase().includes(term)) {
                matches.push({ reference: data.book + ' ' + ch.chapter + ':' + verse.verse, text: verse.text, book: data.book, chapter: Number(ch.chapter) });
                if (matches.length >= 100) break;
              }
            }
            if (matches.length >= 100) break;
          }
          if (matches.length >= 100) break;
        }
        if (matches.length >= 100) break;
      }
      setAllSearchResults(matches);
      setSearchedAll(true);
    } catch {
      setError('Unable to search the whole Bible. Please check your internet connection and try again.');
    } finally {
      setSearchingAll(false);
    }
  };

  const toggleSaved = (reference: string) => {
    setSaved(items => items.includes(reference) ? items.filter(item => item !== reference) : [...items, reference]);
  };

  const moveChapter = (direction: number) => {
    const next = chapter + direction;
    if (next >= 1 && next <= chapterCounts[book]) {
      setChapter(next);
      return;
    }
    const index = books.indexOf(book) + direction;
    if (index >= 0 && index < books.length) {
      setBook(books[index]);
      setChapter(direction > 0 ? 1 : chapterCounts[books[index]]);
    }
  };

  const speakChapter = () => {
    if (!('speechSynthesis' in window)) {
      setError('Audio reading is not supported by this browser.');
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const text = currentVerses.map(v => v.text).join(' ');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const askVoiceCompanion = async (questionOverride?: string) => {
    const question = (questionOverride || voiceQuestion).trim();
    if (!question || voiceBusy) return;
    if (!navigator.onLine) { setVoiceNotice('The AI companion needs an internet connection. You can still read downloaded Bible chapters aloud offline.'); return; }
    setVoiceQuestion(question); setVoiceBusy(true); setVoiceNotice(''); setVoiceAnswer('');
    try {
      const result = await api.post('/api/voice-companion', { question, currentReference: book + ' ' + chapter });
      const answer = typeof result.data?.answer === 'string' ? result.data.answer : 'I could not prepare an answer just now. Please try again.';
      setVoiceAnswer(answer);
      if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(answer); utterance.lang = 'en-GB'; utterance.rate = 0.92; window.speechSynthesis.speak(utterance); }
    } catch { setVoiceNotice('I could not reach the Bible companion. Please check your connection and try again.'); }
    finally { setVoiceBusy(false); }
  };
  const startVoiceListening = () => {
    const browserWindow = window as Window & { SpeechRecognition?: new () => VoiceRecognition; webkitSpeechRecognition?: new () => VoiceRecognition };
    const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
    if (!Recognition) { setVoiceNotice('Voice input is not supported in this browser yet. You can type your question below.'); return; }
    try {
      const recognition = new Recognition(); voiceRecognition.current = recognition; recognition.lang = 'en-GB'; recognition.interimResults = false;
      recognition.onresult = event => { const transcript = event.results[0]?.[0]?.transcript || ''; if (transcript) { setVoiceQuestion(transcript); void askVoiceCompanion(transcript); } };
      recognition.onerror = () => { setVoiceListening(false); setVoiceNotice('I could not hear that clearly. Please try again or type your question.'); };
      recognition.onend = () => setVoiceListening(false); setVoiceNotice('Listening… Speak your Bible question.'); setVoiceListening(true); recognition.start();
    } catch { setVoiceListening(false); setVoiceNotice('Microphone could not start. Check your browser permission or type your question.'); }
  };
  const closeVoiceCompanion = () => { voiceRecognition.current?.stop(); voiceRecognition.current = null; setVoiceListening(false); setVoiceOpen(false); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); };

  const startPrayerAmbient = async () => {
    try {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const master = context.createGain();
      master.gain.value = ((window as any).prayerAmbientVolume || 0) * 0.045;
      master.connect(context.destination);
      const oscillators: OscillatorNode[] = [];
      [130.81, 164.81, 196].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const voiceGain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        voiceGain.gain.value = index === 0 ? 0.5 : 0.25;
        oscillator.connect(voiceGain);
        voiceGain.connect(master);
        oscillator.start();
        oscillators.push(oscillator);
      });
      (window as any).ambientAudioContextRef.current = context;
      (window as any).ambientGainRef.current = master;
      (window as any).ambientOscillatorsRef.current = oscillators;
      await context.resume();
      stopPrayerAmbient();
    } catch {
      setError('Prayer background sound could not start on this device. Please try again.');
    }
  };

  const stopPrayerAmbient = () => {
    (window as any).ambientOscillatorsRef.current.forEach((oscillator: any) => { try { oscillator.stop(); } catch { /* Already stopped. */ } });
    (window as any).ambientOscillatorsRef.current = [];
    const context = (window as any).ambientAudioContextRef.current;
    (window as any).ambientAudioContextRef.current = null;
    (window as any).ambientGainRef.current = null;
    if (context && context.state !== 'closed') void context.close();
    stopPrayerAmbient();
  };

  const closePrayerExperience = () => {
    setPrayer(false);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    (window as any).setPrayerSpeaking?.(false);
    stopPrayerAmbient();
  };

  const displayName = customDisplayName || profileName || account?.name || '';

  const nav: { name: Tab; icon: typeof Home }[] = [
    { name:'Home', icon:Home }, { name:'Bible', icon:BookOpen },
    { name:'Stories', icon:BookMarked }, { name:'Prayer', icon:Heart },
    { name:'More', icon:Settings }
  ];

  if (!authChecked) return (
    <div className="splash-screen" role="status" aria-live="polite">
      <div className="splash-glow" />
      <div className="splash-content">
        <div className="splash-emblem"><img src="/resources/holy-bible-kjv-icon.png" alt="Holy Bible KJV" /></div>
        <span className="eyebrow light">THE HOLY SCRIPTURES</span>
        <h1>Holy Bible<br /><em>King James Version</em></h1>
        <p>Restoring your place in Scripture…</p>
        <div className="splash-version">KING JAMES VERSION · KJV</div>
      </div>
      <div className="splash-stars">✦　·　✧　·　✦</div>
    </div>
  );

  if (showSplash) return (
    <div className="splash-screen">
      <div className="splash-glow" />
      <div className="splash-content">
        <div className="splash-emblem"><img src="/resources/holy-bible-kjv-icon.png" alt="Holy Bible KJV" /></div>
        <span className="eyebrow light">THE HOLY SCRIPTURES</span>
        <h1>Holy Bible<br /><em>King James Version</em></h1>
        <p>Read God’s Word. Find wisdom and hope.<br />Grow in faith every day.</p>
        <div className="splash-version">KING JAMES VERSION · KJV</div>
        <button className="splash-start" onClick={() => openNamePrompt('guest')}>Open Bible <ChevronRight size={18} /></button>
        <button className="splash-account" onClick={() => openNamePrompt('signin')}>Sign up / Log in</button>
        {authMessage && <small className="splash-auth-message">{authMessage}</small>}
        <small>God’s Word for every generation.</small>
      </div>
      {showNotificationSetup && !showSplash && <div className="overlay prayer-overlay" onClick={() => { setShowNotificationSetup(false); try { localStorage.setItem('kjv-prayer-reminders-onboarded', 'dismissed'); } catch { /* Optional preference. */ } }}><section className="modal prayer-modal prayer-experience" role="dialog" aria-modal="true" aria-labelledby="prayer-reminder-welcome" onClick={e => e.stopPropagation()}><button className="close prayer-close" onClick={() => { setShowNotificationSetup(false); try { localStorage.setItem('kjv-prayer-reminders-onboarded', 'dismissed'); } catch { /* Optional preference. */ } }} aria-label="Close reminder setup"><X /></button><div className="prayer-mark">🔔</div><span className="eyebrow prayer-eyebrow">A GENTLE DAILY REMINDER</span><h2 id="prayer-reminder-welcome">Stay close to prayer</h2><p className="prayer-intro">Would you like Holy Bible KJV to send fresh, Scripture-based prayers in the morning, afternoon and evening? We’ll vary the prayers so you are not seeing the same one every day.</p>{!account && <p className="prayer-intro">Sign in once to connect reminders to your account. You can still read the Bible and pray as a guest.</p>}{reminderStatus && <p className="prayer-reminder-status" role="status">{reminderStatus}</p>}{reminderGuidance && <div className="prayer-permission-guide"><b>{reminderGuidance.title}</b><p>{reminderGuidance.message}</p>{reminderGuidance.steps.length > 0 && <ol>{reminderGuidance.steps.map((step,index) => <li key={index}>{step}</li>)}</ol>}</div>}<button className="prayer-amen" onClick={() => void activateAutomaticPrayerReminders()} disabled={reminderBusy}>{reminderBusy ? 'Setting up…' : account ? 'Allow prayer reminders' : 'Sign in to set up reminders'} <Heart size={16} /></button><button className="prayer-permission-dismiss" onClick={() => { setShowNotificationSetup(false); try { localStorage.setItem('kjv-prayer-reminders-onboarded', 'dismissed'); } catch { /* Optional preference. */ } }}>Not now</button></section></div>}
      {showOpeningPrayerPrompt && !showSplash && <div className="overlay prayer-overlay" onClick={() => setShowOpeningPrayerPrompt(false)}><section className="modal prayer-modal prayer-experience" role="dialog" aria-modal="true" aria-labelledby="opening-prayer-title" onClick={e => e.stopPropagation()}><button className="close prayer-close" onClick={() => setShowOpeningPrayerPrompt(false)} aria-label="Close prayer invitation"><X /></button><div className="prayer-mark">🙏</div><span className="eyebrow prayer-eyebrow">A MOMENT WITH GOD</span><h2 id="opening-prayer-title">Would you like to pray?</h2><p className="prayer-intro">Take a quiet moment to bring your heart before God. A fresh prayer is ready whenever you are.</p><button className="prayer-amen" onClick={() => { setSelectedPrayer(Math.floor(Math.random() * prayerOptions.length)); setPrayerCompleted(false); setPrayer(true); setShowOpeningPrayerPrompt(false); }}>Pray now <Heart size={16} /></button><button className="prayer-permission-dismiss" onClick={() => setShowOpeningPrayerPrompt(false)}>Not now</button></section></div>}
      {namePromptOpen && <div className="overlay" onClick={() => setNamePromptOpen(false)}><div className="modal name-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setNamePromptOpen(false)} aria-label="Close name form"><X /></button><div className="name-modal-mark">✦</div><span className="eyebrow">A PERSONAL WELCOME</span><h2>What should we call you?</h2><p>Your name will appear on your prayer completion message. You can use Holy Bible KJV as a guest or sign in to your account.</p><label className="name-field-label" htmlFor="profile-name">YOUR FIRST NAME</label><input id="profile-name" className="name-field" autoComplete="given-name" maxLength={40} placeholder="Enter your first name" value={nameDraft} onChange={e => setNameDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && nameDraft.trim()) void continueWithName(); }} /><button className="name-continue-button" disabled={!nameDraft.trim()} onClick={() => void continueWithName()}>{namePromptMode === 'signin' ? 'Continue to sign in' : 'Continue as guest'} <ChevronRight size={17} /></button>{namePromptMode === 'guest' && <button className="name-skip-button" onClick={continueAsGuestWithoutName}>Continue without a name</button>}</div></div>}
      <div className="splash-stars">✦　·　✧　·　✦</div>
    </div>
  );

  return (
    <UiLanguage language={selectedLanguage as 'English' | 'Spanish' | 'French'}>
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">📖</div>
        <div className="brand">
          <b>Holy Bible KJV</b>
          <small>King James Version · 66 books</small>
        </div>
        <button className="account-btn" onClick={account ? () => { setEditingProfileName(false); setProfileOpen(true); } : () => openNamePrompt('signin')}>{account ? (displayName || account.email || 'My Profile') : 'Sign up / Log in'}</button>
        <button className="round gold" onClick={() => setPrayer(true)} aria-label="Prayer"><Heart size={18} /></button>
        <button className="round" onClick={() => setShowSettings(true)} aria-label="Settings"><Settings size={18} /></button>
      </header>

      <main className="main">
        {authMessage && <div className="auth-message" role="status">{authMessage}</div>}
        {tab === 'Home' && <section className="home-page">
          <div className="welcome">
            <span className="eyebrow">WELCOME TO THE HOLY BIBLE</span>
            <h1>Grow in faith, <em>every day.</em></h1>
            <p>Read the King James Bible, explore Scripture and spend time in God’s Word.</p>
            <div className="welcome-actions">
              <button className="primary" onClick={() => goToBible('Genesis', 1)}><BookOpen size={17} /> Read the Bible</button>
              <button className="soft-btn" onClick={() => setTab('Stories')}><Sparkles size={17} /> Bible stories</button>
            </div>
          </div>
          <div className="streak-card">
            <div><span className="eyebrow light">THE HOLY SCRIPTURES</span><h2><BookOpen size={22} /> 66 Books</h2><p>One Bible · Old and New Testaments</p></div>
            <div className="streak-badge">📖</div>
          </div>
          <div className="section-head"><div><span className="eyebrow">VERSE OF THE DAY</span><h2>A promise to remember</h2></div><button className="text-btn" onClick={() => goToBible('Psalms', 23)}>Read <ChevronRight size={16} /></button></div>
          <div className="daily-card">
            <span className="eyebrow light">PSALM 23:1 · KJV</span>
            <blockquote>“The LORD is my shepherd; I shall not want.”</blockquote>
            <div className="daily-foot"><span>Psalm 23:1</span><button onClick={() => toggleSaved('Psalm 23:1')} aria-label="Save verse"><Bookmark size={17} /></button></div>
          </div>
          <div className="section-head"><div><span className="eyebrow">SPEND TIME WITH GOD</span><h2>Helpful reading tools</h2></div></div>
          <div className="feature-list">
            <button className="feature-card" onClick={() => goToBible('John', 1)}><span className="feature-icon">📖</span><span><b>Read Scripture</b><small>Explore all 66 books of the KJV</small></span><ChevronRight /></button>
            <button className="feature-card" onClick={() => setPrayer(true)}><span className="feature-icon">🙏</span><span><b>Prayer</b><small>Take a quiet moment to pray</small></span><ChevronRight /></button>
            <button className="feature-card" onClick={() => setTab('Stories')}><span className="feature-icon">🕊️</span><span><b>Bible stories</b><small>Explore events from Scripture</small></span><ChevronRight /></button>
          </div>
        </section>}

        {tab === 'Bible' && <section className="reader-page" onTouchStart={e => { const target = e.target as HTMLElement; if (target.closest('button, select, input, textarea')) { touchStart.current = null; return; } const t = e.changedTouches[0]; touchStart.current = { x: t.clientX, y: t.clientY }; }} onTouchEnd={e => { if (!touchStart.current) return; const t = e.changedTouches[0]; const dx = t.clientX - touchStart.current.x; const dy = t.clientY - touchStart.current.y; touchStart.current = null; if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.25) moveChapter(dx < 0 ? 1 : -1); }}>
          <div className="reader-toolbar"><div><span className="eyebrow">SCRIPTURE READER</span><h1>{book} {chapter}</h1><p>KING JAMES VERSION · KJV</p></div><button className="search-button" aria-label="Search Bible" title="Search this book" onClick={() => { setQuery(''); setSearchOpen(true); }}><Search size={19} /></button></div>
          <div className="book-select">
            <label>BOOK OF THE BIBLE</label>
            <select value={book} onChange={e => { setBook(e.target.value); setChapter(1); }}>{books.map(name => <option key={name} value={name}>{name}</option>)}</select>
            <label>CHAPTER</label>
            <select value={chapter} onChange={e => setChapter(Number(e.target.value))}>{Array.from({length:chapterCounts[book]},(_,i) => i+1).map(n => <option key={n} value={n}>Chapter {n}</option>)}</select>
          </div>
          <div className="passage-heading"><span className="eyebrow">KING JAMES VERSION</span><h2>{book} {chapter}</h2><p>Holy Bible · Authorized King James Version</p><small className="swipe-hint">Swipe left for next chapter · swipe right for previous</small></div>
          {loading && <div className="empty-state">Loading {book} from the KJV Bible…</div>}
          {error && <div className="error-state"><p>{error}</p><button className="primary" onClick={() => { bookCache.delete(book); setBookData(null); setBook(book); }}>Try again</button></div>}
          {!loading && !error && <article className="verses">
            {currentVerses.map(v => {
              const reference = book + ' ' + chapter + ':' + v.verse;
              return <div className="verse" key={v.verse}><span>{v.verse}</span><p style={{fontSize:font}}>{v.text}</p><button onClick={() => toggleSaved(reference)} className={saved.includes(reference) ? 'is-saved' : ''} aria-label={'Save ' + reference}><Bookmark size={16} /></button></div>;
            })}
          </article>}
          <div className="reader-settings"><b>Reading controls</b><p>Adjust the text size or listen to this chapter.</p><div className="font-controls"><button onClick={() => setFont(Math.max(14,font-1))}>A−</button><button onClick={() => setFont(17)}>Aa</button><button onClick={() => setFont(Math.min(27,font+1))}>A+</button></div><div className="reader-actions"><button className="primary" onClick={speakChapter}><Volume2 size={16} /> {speaking ? 'Stop audio' : 'Read chapter aloud'}</button></div></div>
          <p className="source-note">KJV text source: public Bible-kjv dataset. Downloaded books are saved on this device for offline reading.</p>
        </section>}

        {tab === 'Stories' && <section className="kids-page">
          <div className="kids-hero"><span className="eyebrow light">PEOPLE AND EVENTS IN SCRIPTURE</span><h1>Bible stories<br />and teachings</h1><p>Explore well-known events from the Old and New Testaments and read the passages in the KJV.</p><div className="kids-stats"><span>66 books</span><span>{saved.length} saved verses</span></div></div>
          <div className="section-head"><div><span className="eyebrow">EXPLORE SCRIPTURE</span><h2>Choose a Bible story</h2></div></div>
          <div className="story-grid">{stories.map((story,i) => <button className="story-card" key={story.title} onClick={() => setSelectedStory(i)}><div className="story-art">{['🌍','🌈','🌊','🪨','🦁','⭐','🤝','✝️'][i]}</div><div className="story-info"><span>{story.ref}</span><b>{story.title}</b><small>{story.text}</small><strong>Read passage <ChevronRight size={15} /></strong></div></button>)}</div>
        </section>}

        {tab === 'Prayer' && <section className="more-page prayer-settings-tab">
          <div className="more-heading"><span className="eyebrow">YOUR PRIVATE PRAYER SPACE</span><h1>Prayer requests</h1><p>Write or update your personal prayer request and choose the time you want to set aside for prayer.</p></div>
          <div className="prayer-settings-page prayer-settings-inline">
            <div className="prayer-journal-card">
              <div className="prayer-journal-top">
                <div className="prayer-journal-icon"><BookOpen size={20} /></div>
                <div><span className="prayer-journal-kicker">A LETTER TO GOD</span><h2>Your prayer journal</h2></div>
                <span className="prayer-edit-tag"><Sparkles size={13} /> Edit anytime</span>
              </div>
              <p className="prayer-journal-intro">There is no perfect way to pray. Write what is on your heart and place it before God.</p>
              <label className="prayer-settings-label" htmlFor="personal-prayer">YOUR PERSONAL PRAYER</label>
              <div className="prayer-writing-wrap">
                <span className="prayer-writing-mark">“</span>
                <textarea id="personal-prayer" value={prayerRequest} onChange={e => { setPrayerRequest(e.target.value); setPrayerRequestSaved(false); }} placeholder="Dear Lord, today I want to bring before You..." rows={7} />
                <div className="prayer-writing-footer"><span>{prayerRequest.length} characters</span><span><Heart size={13} /> Written from the heart</span></div>
              </div>
              <button className="scripture-picker-trigger" onClick={() => setScripturePickerOpen(true)}><BookOpen size={17} /> {selectedScripture ? 'Change attached Scripture' : 'Choose a Bible Scripture'}</button>
              {selectedScripture && <div className="attached-scripture"><span>ATTACHED KJV SCRIPTURE · {selectedScripture.reference}</span><p>“{selectedScripture.text}”</p><button onClick={() => setSelectedScripture(null)}>Remove Scripture</button></div>}
              <div className="prayer-reminder-card personal-prayer-reminder-card">
                <div className="prayer-reminder-copy"><span className="prayer-reminder-icon"><Heart size={17} /></span><div><b>My prayer-point reminder</b><small>Set a personal time to remember this saved prayer.</small></div></div>
                <div className="personal-prayer-time-row">
                  <label><input type="checkbox" checked={personalPrayerReminder.enabled} onChange={e => setPersonalPrayerReminder(current => ({ ...current, enabled: e.target.checked }))} /> Remind me about this prayer</label>
                  <input aria-label="My prayer point reminder time" type="time" step="300" value={personalPrayerReminder.time} disabled={!personalPrayerReminder.enabled} onChange={e => setPersonalPrayerReminder(current => ({ ...current, time: e.target.value }))} />
                </div>
                <p className="prayer-schedule-note">This is separate from your morning, afternoon and night written-prayer reminders.</p>
              </div>
              <div className="prayer-reminder-card prayer-schedule-card">
                <div className="prayer-reminder-copy"><span className="prayer-reminder-icon"><Clock size={17} /></span><div><b>Daily prayer reminders</b><small>Once enabled, fresh prayers arrive automatically in the morning, afternoon and at night. The app chooses the times and prayer for you.</small></div></div>
                {reminderEnabled && <p className="prayer-reminder-status" role="status">Automatic prayer reminders are active on your account.</p>}
              </div>
              <button className="prayer-save prayer-journal-save" onClick={savePrayerJournal}><Heart size={16} /> {prayerRequestSaved ? 'Update my saved prayer' : 'Save my prayer point'}</button>
              {prayerRequestSaved && <div className="prayer-saved-note prayer-journal-confirm"><CheckCircle2 size={15} /> Your personal prayer point is saved on this device.</div>}
              <p className="prayer-local-note">Your prayer and attached Scripture are saved on this device. Daily notifications require sign-in and notification permission. Your phone controls the notification sound.</p>
            </div>
          </div>
          <div className="prayer-ad-slot"><span>ADVERTISEMENT</span><p>Ad space</p></div>
        </section>}

        {tab === 'More' && <section className="more-page">
          <div className="more-heading"><span className="eyebrow">YOUR BIBLE COMPANION</span><h1>More tools</h1><p>Helpful ways to read, reflect and keep Scripture close.</p></div>
          <section className="offline-library-card">
            <div className="offline-library-top">
              <span className="offline-library-icon"><BookOpen size={21} /></span>
              <div><span className="eyebrow">READ WITHOUT INTERNET</span><h2>Offline Bible library</h2></div>
              <span className={isOnline ? 'offline-status online' : 'offline-status'}>{isOnline ? 'Online' : 'Offline'}</span>
            </div>
            <p>The complete 66-book King James Bible is included with the app. It is automatically saved on this device for offline reading, even after you close the app.</p>
            <div className="offline-progress-copy"><b>{offlineBookCount} of 66 books saved</b><span>{downloadProgress}%</span></div>
            <div className="offline-progress-track"><span style={{ width: Math.max(downloadProgress, offlineBookCount ? (offlineBookCount / 66) * 100 : 0) + '%' }} /></div>
            <button className="offline-download-button" onClick={downloadCompleteBible} disabled={downloadingBible || offlineBookCount === 66}>
              <BookOpen size={17} /> {downloadingBible ? 'Preparing offline Bible…' : offlineBookCount === 66 ? 'Bible saved for offline reading' : offlineBookCount ? 'Prepare offline Bible' : 'Save all 66 books for offline reading'}
            </button>
            {downloadingBible && <p className="offline-download-hint">Keep the app open and connected while the books are being saved.</p>}
            {offlineMessage && <p className="offline-message" role="status">{offlineMessage}</p>}
            {offlineBookCount === 66 && <p className="offline-ready"><CheckCircle2 size={16} /> Offline ready — all 66 books are on this device.</p>}
          </section>
          <section className="bible-notes-card">
            <span className="eyebrow">YOUR PERSONAL SCRIPTURE JOURNAL</span>
            <h2>My Bible Notes</h2>
            <p>Write reflections, study notes or prayer thoughts. Use the microphone to dictate, then review and edit before saving. Notes stay on this device.</p>
            <textarea aria-label="Bible note" value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="Write what stood out to you in today's reading…" />
            <div className="notes-actions">
              <button type="button" onClick={notesListening ? stopNotesDictation : startNotesDictation}>{notesListening ? 'Stop dictation' : '🎙️ Dictate note'}</button>
              <button type="button" className="secondary" onClick={saveBibleNote}>{editingNoteId === null ? 'Save note' : 'Update note'}</button>
              {editingNoteId !== null && <button type="button" className="secondary" onClick={() => { setEditingNoteId(null); setNoteDraft(''); }}>Cancel edit</button>}
            </div>
            {notesStatus && <p className="notes-status" role="status">{notesStatus}</p>}
            <div className="saved-notes-list">{bibleNotes.length ? bibleNotes.map(note => <article className="note-entry" key={note.id}><b>{new Date(note.updatedAt).toLocaleString()}</b><p>{note.text}</p><button type="button" onClick={() => { setEditingNoteId(note.id); setNoteDraft(note.text); setNotesStatus('Edit your note, then save the update.'); }}>Edit</button><button type="button" onClick={() => removeBibleNote(note.id)}>Delete</button></article>) : <p>No notes saved yet. Your first reflection can go here.</p>}</div>
          </section>
          <div className="more-grid">
            <button className="more-tile" onClick={() => goToBible('Psalms',23)}><span>📖</span><b>Open Psalms</b><small>Read the book of Psalms</small></button>
            <button className="more-tile" onClick={() => setPrayer(true)}><span>🙏</span><b>Prayer</b><small>Pause and pray</small></button>
            <button className="more-tile" onClick={() => setSearchOpen(true)}><span>🔎</span><b>Find a verse</b><small>Search within a book</small></button>
            <button className="more-tile" onClick={() => setTab('Stories')}><span>🕊️</span><b>Bible stories</b><small>Explore Scripture events</small></button>
            <button className="more-tile" onClick={() => setShowSettings(true)}><span>⚙️</span><b>Reading settings</b><small>Adjust text size</small></button>
            <button className="more-tile kids-zone-launch" onClick={() => setKidsZoneOpen(true)}><span>🎮</span><b>Kids Zone</b><small>Bible games, stars and coupons</small></button>
            <div className="more-tile"><span>⭐</span><b>Premium and ad-free plans</b><small>Coming soon</small></div>
            <div className="more-tile"><span>💬</span><b>Contact support</b><small>Support options will appear here soon.</small></div>
            <button className="more-tile" onClick={() => { if (navigator.share) navigator.share({title:'Holy Bible KJV',url:window.location.href}); else navigator.clipboard?.writeText(window.location.href); }}><span>🔗</span><b>Share app</b><small>Share with a friend</small></button>
          </div>
          <div className="about-card"><Cross /><div><b>Holy Bible – King James Version</b><small>God’s Word for every generation.</small></div><span>66 books · KJV</span></div>
        </section>}
      </main>

      <nav className="bottom-nav">{nav.map(item => <button key={item.name} className={tab===item.name?'active':''} onClick={() => setTab(item.name)}><item.icon size={20}/><span>{item.name}</span></button>)}</nav>

      <button
        className="voice-launcher"
        onClick={() => setVoiceOpen(true)}
        aria-label="Open Voice Companion"
        title="Ask the AI Bible Companion"
      >
        <Sparkles size={18} />
        <span>Voice Companion</span>
      </button>

      {voiceOpen && <div className="overlay voice-overlay" onClick={closeVoiceCompanion}>
        <section className="voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-companion-title" onClick={e => e.stopPropagation()}>
          <button className="close" onClick={closeVoiceCompanion} aria-label="Close Voice Companion"><X /></button>
          <div className="voice-emblem"><Sparkles size={27} /></div>
          <span className="eyebrow">YOUR AI BIBLE COMPANION</span>
          <h2 id="voice-companion-title">Voice Companion</h2>
          <p className="voice-intro">Ask a question about the Bible. I’ll explain it with relevant King James Version Scripture references.</p>
          <div className="voice-mode-row">
            <span className="voice-mode online">AI companion · {isOnline ? 'Online' : 'Internet required'}</span>
            <span className="voice-mode">Bible read-aloud available separately</span>
          </div>
          <button className={voiceListening ? 'voice-mic listening' : 'voice-mic'} onClick={startVoiceListening} disabled={voiceBusy}>
            <span><Volume2 size={22} /></span>
            {voiceListening ? 'Listening… speak now' : 'Tap to ask with your voice'}
          </button>
          <label className="voice-label" htmlFor="voice-question">OR TYPE YOUR BIBLE QUESTION</label>
          <textarea
            id="voice-question"
            rows={3}
            value={voiceQuestion}
            onChange={e => setVoiceQuestion(e.target.value)}
            placeholder="For example: What does Psalm 23 teach us?"
          />
          <button className="primary full voice-send" onClick={() => void askVoiceCompanion()} disabled={!voiceQuestion.trim() || voiceBusy}>
            {voiceBusy ? 'Preparing your answer…' : 'Ask the Bible Companion'}
          </button>
          {voiceNotice && <p className="voice-notice" role="status">{voiceNotice}</p>}
          {voiceAnswer && <div className="voice-answer" aria-live="polite">
            <span className="eyebrow">BIBLE COMPANION RESPONSE</span>
            <p>{voiceAnswer}</p>
            <small>This is an AI-generated explanation to help you explore Scripture, not a Bible verse or a message spoken on God’s behalf.</small>
            <button onClick={() => { if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(voiceAnswer); utterance.lang = 'en-GB'; utterance.rate = 0.92; window.speechSynthesis.speak(utterance); } }}>
              <Volume2 size={15} /> Listen again
            </button>
          </div>}
          <p className="voice-footnote">The AI question-answering feature needs an internet connection. Microphone recognition depends on your browser; you can always type your question.</p>
        </section>
      </div>}

      {searchOpen && <div className="overlay" onClick={() => setSearchOpen(false)}><div className="modal search-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setSearchOpen(false)}><X /></button><span className="eyebrow">KJV SCRIPTURE SEARCH</span><h2>Search {book}</h2><p>Search words or phrases in the selected book. Choose a result to open its chapter.</p><div className="search-field"><Search /><input autoFocus placeholder={'Search words or phrases in ' + book} value={query} onChange={e => { setQuery(e.target.value); setAllSearchResults([]); setSearchedAll(false); }} /><button onClick={() => { setQuery(''); setAllSearchResults([]); setSearchedAll(false); }}>Clear</button></div><button className="primary full" onClick={searchEntireBible} disabled={!query.trim() || searchingAll}>{searchingAll ? 'Searching all 66 books…' : 'Search entire Bible'}</button><div className="search-results">{allSearchResults.length ? <><b className="search-section-title">Results across the Bible</b>{allSearchResults.map(result => <button key={result.reference} onClick={() => goToBible(result.book, result.chapter)}><b>{result.reference}</b><span>{result.text}</span></button>)}</> : searchedAll ? <p>No matches found in the Bible. Try another word or phrase.</p> : query.trim() ? searchResults.length ? <><b className="search-section-title">Matches in {book}</b>{searchResults.map(result => <button key={result.reference} onClick={() => { setChapter(result.chapter); setSearchOpen(false); }}><b>{result.reference}</b><span>{result.text}</span></button>)}</> : <p>No matches found in {book}. You can search all 66 books above.</p> : <p>Enter a word or phrase, then search the entire Bible or browse matches in {book}.</p>}</div><span className="eyebrow book-label">JUMP TO A BOOK</span><div className="book-chips">{books.map(name => <button key={name} onClick={() => { setBook(name); setChapter(1); setQuery(''); }}>{name}</button>)}</div></div></div>}

      {scripturePickerOpen && <div className="overlay" onClick={() => setScripturePickerOpen(false)}><div className="modal scripture-picker-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setScripturePickerOpen(false)}><X /></button><span className="eyebrow">KING JAMES VERSION</span><h2>Choose a Scripture</h2><p>Select a book and chapter, then tap the verse you want to attach to your prayer.</p><label>BOOK OF THE BIBLE</label><select value={scriptureBook} onChange={e => { setScriptureBook(e.target.value); setScriptureChapter(1); }} className="scripture-select">{books.map(name => <option key={name} value={name}>{name}</option>)}</select><label>CHAPTER</label><select value={scriptureChapter} onChange={e => setScriptureChapter(Number(e.target.value))} className="scripture-select">{Array.from({length:chapterCounts[scriptureBook]},(_,i)=>i+1).map(n=><option key={n} value={n}>Chapter {n}</option>)}</select><div className="scripture-verse-list">{scriptureLoading ? <p>Loading KJV Scripture…</p> : (scriptureBookData?.chapters.find(ch=>Number(ch.chapter)===scriptureChapter)?.verses || []).map(verse=><button key={verse.verse} onClick={() => { const chosen={reference:scriptureBook+' '+scriptureChapter+':'+verse.verse,text:verse.text}; setSelectedScripture(chosen); setPrayerRequestSaved(false); setScripturePickerOpen(false); }}><b>{scriptureBook} {scriptureChapter}:{verse.verse}</b><span>{verse.text}</span></button>)}</div></div></div>}
      {selectedStory !== null && <div className="overlay" onClick={() => setSelectedStory(null)}><div className="modal story-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setSelectedStory(null)}><X /></button><div className="big-emoji">📖</div><span className="eyebrow">BIBLE STORY · {stories[selectedStory].ref}</span><h2>{stories[selectedStory].title}</h2><p>{stories[selectedStory].text}</p><button className="primary full" onClick={() => { const parts=stories[selectedStory].ref.match(/^(.*) (\d+)$/); if(parts) goToBible(parts[1],Number(parts[2])); }}>Read KJV passage <ChevronRight /></button></div></div>}

      {prayer && <div className="overlay prayer-overlay" onClick={closePrayerExperience}><div className="modal prayer-modal prayer-experience" onClick={e => e.stopPropagation()}>
        <button className="close prayer-close" onClick={closePrayerExperience} aria-label="Close prayer"><X /></button>
        {!prayerCompleted ? <>
          <div className="prayer-mark">🙏</div>
          <span className="eyebrow prayer-eyebrow">A QUIET MOMENT WITH GOD</span>
          <h2>{prayerOptions[selectedPrayer].title}</h2>
          <p className="prayer-intro">{prayerOptions[selectedPrayer].intro}</p>
          <div className="prayer-verse"><span>BE STILL</span><b>{prayerOptions[selectedPrayer].verse}</b><p>“{prayerOptions[selectedPrayer].scripture}”</p><small>Take this promise with you today.</small></div>
          <div className="prayer-quiet"><Moon size={15} /> Read this prayer quietly, at your own pace. Take a moment with each word.</div>
          <div className="prayer-words"><p>{concisePrayerTexts[selectedPrayer]}</p></div>
          <button className="prayer-amen" onClick={() => setPrayerCompleted(true)}>Amen <Heart size={16} /></button>
        </> : <>
          <div className="prayer-mark completed-mark"><CheckCircle2 size={42} /></div>
          <span className="eyebrow prayer-eyebrow">PRAYER COMPLETE</span>
          <h2>God is with you{displayName ? ', ' + displayName : ''}.</h2>
          <p className="prayer-intro">Keep your faith strong. Even when the road feels difficult, remember that God hears your prayers and walks beside you. Take heart, and keep trusting Him.</p>
          <div className="prayer-verse"><b>“The LORD shall preserve thy going out and thy coming in from this time forth, and even for evermore.”</b><small>Psalm 121:8 · KJV</small></div>
          <button className="prayer-amen" onClick={() => setPrayerCompleted(false)}>Pray again <Heart size={16} /></button>
        </>}
        <button className="prayer-settings-link" onClick={() => { setPrayer(false); setTab('Prayer'); }}><Settings size={15} /> Open prayer requests</button>
      </div></div>}

      {showNotificationSetup && !showSplash && <div className="overlay prayer-overlay" onClick={() => { setShowNotificationSetup(false); try { localStorage.setItem('kjv-prayer-reminders-onboarded', 'dismissed'); } catch { /* Optional preference. */ } }}><section className="modal prayer-modal prayer-experience" role="dialog" aria-modal="true" aria-labelledby="prayer-reminder-welcome" onClick={e => e.stopPropagation()}><button className="close prayer-close" onClick={() => { setShowNotificationSetup(false); try { localStorage.setItem('kjv-prayer-reminders-onboarded', 'dismissed'); } catch { /* Optional preference. */ } }} aria-label="Close reminder setup"><X /></button><div className="prayer-mark">🔔</div><span className="eyebrow prayer-eyebrow">A GENTLE DAILY REMINDER</span><h2 id="prayer-reminder-welcome">Stay close to prayer</h2><p className="prayer-intro">Would you like Holy Bible KJV to send fresh, Scripture-based prayers in the morning, afternoon and evening? We’ll vary the prayers so you are not seeing the same one every day.</p>{!account && <p className="prayer-intro">Sign in once to connect reminders to your account. You can still read the Bible and pray as a guest.</p>}{reminderStatus && <p className="prayer-reminder-status" role="status">{reminderStatus}</p>}{reminderGuidance && <div className="prayer-permission-guide"><b>{reminderGuidance.title}</b><p>{reminderGuidance.message}</p>{reminderGuidance.steps.length > 0 && <ol>{reminderGuidance.steps.map((step,index) => <li key={index}>{step}</li>)}</ol>}</div>}<button className="prayer-amen" onClick={() => void activateAutomaticPrayerReminders()} disabled={reminderBusy}>{reminderBusy ? 'Setting up…' : account ? 'Allow prayer reminders' : 'Sign in to set up reminders'} <Heart size={16} /></button><button className="prayer-permission-dismiss" onClick={() => { setShowNotificationSetup(false); try { localStorage.setItem('kjv-prayer-reminders-onboarded', 'dismissed'); } catch { /* Optional preference. */ } }}>Not now</button></section></div>}
      {showOpeningPrayerPrompt && !showSplash && <div className="overlay prayer-overlay" onClick={() => setShowOpeningPrayerPrompt(false)}><section className="modal prayer-modal prayer-experience" role="dialog" aria-modal="true" aria-labelledby="opening-prayer-title" onClick={e => e.stopPropagation()}><button className="close prayer-close" onClick={() => setShowOpeningPrayerPrompt(false)} aria-label="Close prayer invitation"><X /></button><div className="prayer-mark">🙏</div><span className="eyebrow prayer-eyebrow">A MOMENT WITH GOD</span><h2 id="opening-prayer-title">Would you like to pray?</h2><p className="prayer-intro">Take a quiet moment to bring your heart before God. A fresh prayer is ready whenever you are.</p><button className="prayer-amen" onClick={() => { setSelectedPrayer(Math.floor(Math.random() * prayerOptions.length)); setPrayerCompleted(false); setPrayer(true); setShowOpeningPrayerPrompt(false); }}>Pray now <Heart size={16} /></button><button className="prayer-permission-dismiss" onClick={() => setShowOpeningPrayerPrompt(false)}>Not now</button></section></div>}
      {namePromptOpen && <div className="overlay" onClick={() => setNamePromptOpen(false)}><div className="modal name-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setNamePromptOpen(false)} aria-label="Close name form"><X /></button><div className="name-modal-mark">✦</div><span className="eyebrow">A PERSONAL WELCOME</span><h2>What should we call you?</h2><p>Your name will appear on your prayer completion message. You can use Holy Bible KJV as a guest or sign in to your account.</p><label className="name-field-label" htmlFor="profile-name">YOUR FIRST NAME</label><input id="profile-name" className="name-field" autoComplete="given-name" maxLength={40} placeholder="Enter your first name" value={nameDraft} onChange={e => setNameDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && nameDraft.trim()) void continueWithName(); }} /><button className="name-continue-button" disabled={!nameDraft.trim()} onClick={() => void continueWithName()}>{namePromptMode === 'signin' ? 'Continue to sign in' : 'Continue as guest'} <ChevronRight size={17} /></button>{namePromptMode === 'guest' && <button className="name-skip-button" onClick={continueAsGuestWithoutName}>Continue without a name</button>}</div></div>}

      {profileOpen && account && <div className="overlay" onClick={() => setProfileOpen(false)}><div className="modal profile-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => { setProfileOpen(false); setEditingProfileName(false); }} aria-label="Close profile"><X /></button><div className="profile-avatar"><UserCircle size={48} /></div><span className="eyebrow">YOUR ACCOUNT</span><h2>My Profile</h2><div className="profile-detail"><b>Holy Bible display name</b>{editingProfileName ? <><input className="name-field" aria-label="Edit your Holy Bible display name" autoComplete="nickname" maxLength={40} value={profileNameDraft} onChange={e => setProfileNameDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveProfileDisplayName(); }} /><button className="name-continue-button" disabled={!profileNameDraft.trim()} onClick={saveProfileDisplayName}>Save display name</button><button className="name-skip-button" onClick={() => setEditingProfileName(false)}>Cancel</button></> : <><span>{displayName || 'Not provided'}</span><button className="name-continue-button" onClick={() => { setProfileNameDraft(displayName || account.name || ''); setEditingProfileName(true); }}>Edit Name</button></>}</div><div className="profile-detail"><b>Google account name</b><span>{account.name || 'Not available'}</span></div><div className="profile-detail"><b>Email address</b><span><Mail size={15} /> {account.email || 'Not available'}</span></div><p className="profile-note">Your Holy Bible display name is saved separately on this device. Editing it does not change your Google account name or email. It stays saved when you close the app or sign out and back in on this device.</p><button className="profile-signout" onClick={() => { setProfileOpen(false); void signOut(); }}><LogOut size={17} /> Sign out</button></div></div>}

      {showSettings && <div className="overlay" onClick={() => setShowSettings(false)}><div className="modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setShowSettings(false)}><X /></button><span className="eyebrow">PREFERENCES</span><h2>Reading settings</h2><p>Choose a comfortable Scripture text size.</p><div className="font-controls"><button onClick={() => setFont(Math.max(14,font-1))}>A−</button><b>{font}px</b><button onClick={() => setFont(Math.min(27,font+1))}>A+</button></div><p className="muted">Your selected text size applies to the Bible reader.</p><label className="name-field-label" htmlFor="country-choice">COUNTRY / REGION</label><select id="country-choice" className="preference-select" value={selectedCountry} onChange={event => { const country = event.target.value; setSelectedCountry(country); const suggested = country === 'France' ? 'French' : country === 'Spain' ? 'Spanish' : ['Nigeria','Ghana','Kenya','South Africa','United States','United Kingdom','Canada','India'].includes(country) ? 'English' : selectedLanguage; setSelectedLanguage(suggested); try { localStorage.setItem('kjv-country', country); localStorage.setItem('kjv-language', suggested); } catch { /* Keep preferences for this session. */ } }}><option>Nigeria</option><option>Ghana</option><option>Kenya</option><option>South Africa</option><option>United States</option><option>United Kingdom</option><option>Canada</option><option>India</option><option>France</option><option>Spain</option><option>Other</option></select><label className="name-field-label" htmlFor="language-choice">APP LANGUAGE PREFERENCE</label><select id="language-choice" className="preference-select" value={selectedLanguage} onChange={event => { setSelectedLanguage(event.target.value); try { localStorage.setItem('kjv-language', event.target.value); } catch { /* Keep this preference for the current session. */ } }}><option>English</option><option>Spanish</option><option>French</option></select><p className="preference-help">Your country and language choices are saved on this device. The Bible text remains the King James Version in English.</p></div></div>}
      {kidsZoneOpen && <KidsZone onClose={() => setKidsZoneOpen(false)} />}
    </div>
    </UiLanguage>
  );
}

export default App;
