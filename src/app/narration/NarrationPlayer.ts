/**
 * נגן הקריינות — **שכבה נפרדת לגמרי מ-AudioManager** (ENGINE-narration.md
 * סעיף 2):
 * - לא עובר דרך `AudioManager.play`, ולכן אינו עוצר את סאונד המשחק ואינו נעצר
 *   על ידו. כלל הבלעדיות של מנהל הסאונד נשאר בדיוק כפי שהוא.
 * - Web Audio: AudioContext אחד (נוצר בעצלתיים), GainNode ראשי קבוע (ווליום
 *   והשתקה חיים), ומטמון AudioBuffer לפי כתובת — כל קטע נטען ומפוענח פעם אחת.
 * - `say` משבץ את הקטעים אחד אחרי השני על שעון ה-AudioContext, בלי חורים
 *   נשמעים בין קטעי מספר מורכב.
 * - `cancel` עוצר מיד — "הקריינות נגררת אחרי המסך": כל שינוי במה שמוצג מבטל
 *   את מה שמתנגן.
 * - קטע שלא נטען (404/רשת) נשמר במטמון כ-null ומדולג בשקט; הוא לעולם לא חוסם
 *   את שאר המשפט ולא את המשחק.
 * - נעילת autoplay: עד האינטראקציה הראשונה של המפעיל הדפדפן לא משמיע כלום.
 *   הנגן מדווח מתי האודיו נפתח (`isUnlocked`/`onUnlock`), והבמאי דוחה עד אז את
 *   המשפטים של "פעם אחת למשחק" במקום לשרוף אותם על אודיו נעול. הפתיחה היא קליק
 *   או מקש שהדפדפן מכיר כאינטראקציה (לא Esc), וההודעה עליה יוצאת רק אחרי
 *   שהאירוע סיים את דרכו — ראו `unlockFn`.
 *
 * כל גישה ל-API של הדפדפן מוגנת (`typeof`), כדי שהמחלקה תהיה בטוחה גם בסביבת
 * הבדיקות (Node) — שם היא פשוט לא משמיעה דבר.
 */

import { debugLog } from '../debugLog.ts';

/** קיצור כתובת לתצוגה בלוג (בלי query ארוך). */
function shortUrl(url: string): string {
  const clean = url.split('?')[0] ?? url;
  const parts = clean.split('/');
  return parts[parts.length - 1] || clean.slice(0, 40);
}

export interface SayOptions {
  /**
   * רווח בין קטעים באותו משפט (ms). ברירת המחדל 0 — הרכבת מספר חייבת להישמע
   * כמילה אחת רציפה ("עשרים ושלוש"), ולכן אין חורים בתוך רצף.
   */
  gapMs?: number;
}

/** כמה קטעים נטענים במקביל בטעינה מוקדמת (עדיפות נמוכה — לא חונקים את הרשת). */
const PRELOAD_CHUNK = 4;

export class NarrationPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  /** כתובת → buffer מפוענח, או null כשהטעינה נכשלה (מדלגים עליו מכאן והלאה). */
  private readonly cache = new Map<string, AudioBuffer | null>();
  /** טעינות שנמצאות באוויר — כדי לא למשוך את אותו קטע פעמיים. */
  private readonly inFlight = new Map<string, Promise<AudioBuffer | null>>();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly speakingListeners = new Set<(speaking: boolean) => void>();
  private speaking = false;
  private volume = 1;
  private muted = false;
  /** מזהה הרצה: כל `say`/`cancel` מקדם אותו, וכך תוצאות ישנות נזרקות. */
  private run = 0;
  private disposed = false;
  private listening = false;
  private readonly unlockFn: () => void;
  /**
   * האודיו נפתח: הייתה אינטראקציה של המפעיל (או sticky activation מלפני שהמשחק
   * עלה), או שההקשר כבר רץ בלעדיה (autoplay מותר — ה-EXE). חד-כיווני.
   */
  private unlocked = false;
  private readonly unlockListeners = new Set<() => void>();

  constructor() {
    // בדיוק כמו AudioManager: אינטראקציה שכבר קרתה במסמך (הקליק שהוביל למשחק)
    // מתירה ניגון מיד. (navigator.userActivation לא קיים בכל סביבה — נזהרים.)
    if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true) {
      this.unlocked = true;
    }
    // פתיחת ה-AudioContext באינטראקציה הראשונה — כמו ב-AudioManager, אבל עם
    // מאזינים משלנו, ובקליק ולא ב-pointerdown: pointerdown מקדים בעשירית שנייה
    // את הקליק שמחליף את המסך, ו"ברוכים הבאים" היה מתחיל בלובי ונחתך מיד.
    // המאזינים ב-capture, כדי שהדגל יידלק לפני ה-onClick / מקש המנחה, והמשפט
    // של המסך שהם פותחים כבר ימתין ל-resume במקום להיזרק.
    this.unlockFn = () => {
      const ctx = this.context;
      if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
      // רק אינטראקציה שהדפדפן מכיר: Esc (שפותח את תפריט המפעיל) או מקש שינוי
      // לבדו אינם כאלה, וה-resume שלהם נתקע עד מגע אמיתי. בלי ה-API (דפדפן
      // ישן) — כמו קודם, כל קליק או מקש נחשב.
      if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === false) {
        return;
      }
      this.markUnlocked();
    };
    this.armUnlockListeners();
  }

  private markUnlocked(): void {
    if (this.unlocked || this.disposed) return;
    this.unlocked = true;
    debugLog('narration', 'האודיו נפתח');
    // ההודעה יוצאת רק אחרי שהאירוע שפתח את האודיו סיים את דרכו. הקליק על
    // "הבא" או על ⚙ כבר החליף את המסך, והצעד שההודעה מריצה רואה את המסך
    // החדש; הצעד שהקליק עצמו הריץ כבר קרא `isUnlocked` ישירות.
    setTimeout(() => {
      if (this.disposed) return;
      for (const listener of this.unlockListeners) listener();
    }, 0);
  }

  /** האם האודיו כבר נפתח (ראו `unlocked`) — קלט לבמאי (DisplayedState.audioUnlocked). */
  isUnlocked(): boolean {
    return this.unlocked;
  }

  /** מנוי על פתיחת האודיו (נקרא פעם אחת, מיד אחרי האירוע שפתח אותו). */
  onUnlock(listener: () => void): () => void {
    this.unlockListeners.add(listener);
    return () => {
      this.unlockListeners.delete(listener);
    };
  }

  private armUnlockListeners(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    window.addEventListener('click', this.unlockFn, true);
    window.addEventListener('keydown', this.unlockFn, true);
  }

  private disarmUnlockListeners(): void {
    if (!this.listening || typeof window === 'undefined') return;
    this.listening = false;
    window.removeEventListener('click', this.unlockFn, true);
    window.removeEventListener('keydown', this.unlockFn, true);
  }

  /** ה-AudioContext והמסכם הראשי, או null בסביבה בלי Web Audio. */
  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.context) return this.context;
    if (typeof AudioContext === 'undefined') return null;
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.volume;
      master.connect(ctx.destination);
      this.context = ctx;
      this.master = master;
      // הקשר שרץ בלי אינטראקציה (autoplay מותר) הוא אודיו פתוח; ההקשר עובר
      // ל-running באופן אסינכרוני, ולכן מאזינים גם לשינוי המצב.
      ctx.onstatechange = () => {
        if (ctx.state === 'running') this.markUnlocked();
      };
      if (ctx.state === 'running') this.markUnlocked();
      return ctx;
    } catch {
      return null; // סביבה בלי אודיו — הקריינות פשוט שותקת
    }
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
    if (muted) this.cancel();
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  /** מנוי על שינוי מצב הדיבור (הנמכת סאונד המשחק / המתנה של מעבר אוטומטי). */
  onSpeakingChange(listener: (speaking: boolean) => void): () => void {
    this.speakingListeners.add(listener);
    return () => {
      this.speakingListeners.delete(listener);
    };
  }

  private setSpeaking(speaking: boolean): void {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
    for (const listener of this.speakingListeners) listener(speaking);
  }

  /** טוען ומפענח קטע בודד; כישלון נשמר כ-null ולא נזרק החוצה לעולם. */
  private load(url: string): Promise<AudioBuffer | null> {
    const cached = this.cache.get(url);
    if (cached !== undefined) return Promise.resolve(cached);
    const flying = this.inFlight.get(url);
    if (flying) return flying;
    const ctx = this.ensureContext();
    if (ctx === null || typeof fetch === 'undefined') {
      this.cache.set(url, null);
      return Promise.resolve(null);
    }
    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const bytes = await res.arrayBuffer();
        return await ctx.decodeAudioData(bytes);
      } catch {
        return null;
      }
    })()
      .then((buffer) => {
        this.cache.set(url, buffer);
        this.inFlight.delete(url);
        if (buffer === null) debugLog('narration', `קטע לא נטען — מדלגים (${shortUrl(url)})`);
        return buffer;
      })
      .catch(() => {
        this.cache.set(url, null);
        this.inFlight.delete(url);
        return null;
      });
    this.inFlight.set(url, promise);
    return promise;
  }

  /**
   * האם הטעינה של הקטע כבר נכשלה (404/רשת/פענוח). קטע שעוד לא נוסה אינו
   * "נכשל". כך ה-host יודע מראש לוותר על קטע שלא יתנגן (שם קבוצה) ולבחור
   * ניסוח אחר, במקום שהמשפט ייקטע באמצע.
   */
  hasFailed(url: string): boolean {
    return this.cache.get(url) === null;
  }

  /**
   * טעינה מוקדמת ברקע (בנק הביטויים, קטעי השקופית הבאה). לעולם אינה זורקת,
   * ואינה מחזיקה את הקורא — מחזירה promise שאפשר להתעלם ממנו.
   */
  async preload(urls: readonly string[]): Promise<void> {
    const pending = urls.filter((url) => url !== '' && !this.cache.has(url));
    for (let i = 0; i < pending.length; i += PRELOAD_CHUNK) {
      if (this.disposed) return;
      await Promise.all(pending.slice(i, i + PRELOAD_CHUNK).map((url) => this.load(url)));
    }
  }

  /**
   * אומר רצף קטעים. כל קריאה מבטלת קודם את מה שמתנגן (המסך מוביל), והקטעים
   * משובצים אחד אחרי השני לפי אורכם. קריאה לפני שהייתה אינטראקציה כלשהי נזרקת
   * *בשקט* ולא נשמרת לתור — קריינות מאחרת גרועה מקריינות חסרה (והבמאי אינו
   * שולח עד אז משפטים של "פעם אחת למשחק"). אחרי האינטראקציה, כשה-resume עוד
   * בדרך, המשפט ממתין לו — אלא אם בוטל בינתיים.
   */
  say(urls: readonly string[], { gapMs = 0 }: SayOptions = {}): void {
    this.cancel();
    if (this.disposed || this.muted) return;
    const clips = urls.filter((url) => url !== '');
    if (clips.length === 0) return;
    const ctx = this.ensureContext();
    if (ctx === null) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});

    const run = this.run;
    void (async () => {
      const buffers = await Promise.all(clips.map((url) => this.load(url)));
      if (this.disposed || this.run !== run) return; // בוטל בזמן הטעינה
      const ready = buffers.filter((b): b is AudioBuffer => b !== null);
      if (ready.length === 0) return;
      if (ctx.state === 'suspended') {
        if (!this.unlocked) {
          debugLog('narration', 'האודיו עדיין נעול — מדלגים על המשפט');
          return;
        }
        // המקש שפתח את האודיו הוא בדרך כלל גם זה שהחליף את המסך, והמשפט של
        // המסך החדש מגיע לכאן לפני שה-resume הסתיים. ממתינים לו במקום לזרוק.
        await ctx.resume().catch(() => {});
        if (this.disposed || this.run !== run) return; // המסך השתנה בינתיים
      }
      if (ctx.state !== 'running') return;
      const master = this.master;
      if (master === null) return;
      // שיבוץ על שעון ה-AudioContext: תחילת כל קטע = סוף הקודם (+ הרווח
      // המוגדר), כך שאין "מדרגות" בין קטעי מספר מורכב.
      let at = ctx.currentTime + 0.02;
      let last: AudioBufferSourceNode | null = null;
      for (const buffer of ready) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(master);
        source.onended = () => {
          this.sources.delete(source);
          if (this.run === run && this.sources.size === 0) this.setSpeaking(false);
        };
        this.sources.add(source);
        source.start(at);
        at += buffer.duration + gapMs / 1000;
        last = source;
      }
      if (last !== null) this.setSpeaking(true);
      debugLog('narration', `אומר ${ready.length} קטעים`, {
        clips: clips.map(shortUrl),
        skipped: clips.length - ready.length,
      });
    })();
  }

  /** עוצר מיד כל מה שמשובץ (כולל קטעים שעדיין לא התחילו). */
  cancel(): void {
    this.run += 1;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* עוד לא התחיל / כבר הסתיים */
      }
      try {
        source.disconnect();
      } catch {
        /* כבר מנותק */
      }
    }
    this.sources.clear();
    this.setSpeaking(false);
  }

  /** ניקוי מלא בעזיבת המשחק — עצירה, הסרת מאזינים וסגירת ה-AudioContext. */
  dispose(): void {
    this.cancel();
    this.disposed = true;
    this.disarmUnlockListeners();
    this.speakingListeners.clear();
    this.unlockListeners.clear();
    const ctx = this.context;
    this.context = null;
    this.master = null;
    if (ctx) {
      try {
        void ctx.close();
      } catch {
        /* סביבה בלי close — מתעלמים */
      }
    }
  }
}
