/**
 * נגן מדיה אחיד: מזהה את הסוג לפי ה-URL בלבד (classifyMediaUrl) ומרנדר
 * תמונה / וידאו / אודיו / YouTube iframe. מדווח onEnded בסיום (וידאו/אודיו/
 * YouTube; לתמונה אין "סיום" — המפעיל מקדם ידנית).
 */

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { classifyMediaUrl, isYoutubeUrl, youtubeEmbedUrl, youtubeVideoId } from '../engine/index.ts';
import { MediaClockContext, MediaMutedContext, MediaPauseContext } from './mediaPause.ts';
import { startYoutubeHandshake } from './youtubeHandshake.ts';

interface MediaPlayerProps {
  src: string;
  onEnded?: () => void;
  /** רקע: וידאו מושתק בלולאה, בלי דיווח סיום. */
  asBackground?: boolean;
  className?: string;
}

/**
 * שם קצר לתצוגה בהודעת כשל (בלי query ונתיב ארוך).
 *
 * בקישור יוטיוב הסגמנט האחרון הוא "watch" — חסר תועלת למי שמנסה להבין איזה
 * סרטון נפל. מציגים במקומו את מזהה הסרטון, שאותו אפשר לחפש.
 */
function shortName(src: string): string {
  const id = youtubeVideoId(src);
  if (id !== null) return `סרטון יוטיוב ${id}`;
  if (isYoutubeUrl(src)) return 'קישור יוטיוב לא תקין';
  const clean = src.split(/[?#]/, 1)[0] ?? src;
  return clean.split('/').pop() || clean.slice(0, 50);
}

export function MediaPlayer({ src, onEnded, asBackground = false, className }: MediaPlayerProps) {
  const kind = classifyMediaUrl(src);
  // מדיה שנכשלה בטעינה: במקום מסך שחור/ריק — חיווי ברור למפעיל (רווח ממשיך
  // כרגיל). ברקע — פשוט לא מציגים כלום (החיווי היה מכער את השקופית).
  const [failed, setFailed] = useState(false);
  // ניסיון-חוזר על כשל טעינה: כשל זמני של פרוקסי/Worker — במיוחד על וידאו כבד
  // שנטען "קר" במסך המנצחים/מובילים — מקבל ניסיון נוסף עם עקיפת מטמון לפני
  // שמוותרים, כדי שרקע לא ייפול למסך שחור בגלל תקלה רגעית. רק אחרי הניסיונות
  // מסמנים "נכשל".
  const RETRIES = 2;
  const [attempt, setAttempt] = useState(0);
  const attemptRef = useRef(0);
  attemptRef.current = attempt;
  const retryTimer = useRef(0);
  useEffect(() => {
    setFailed(false);
    setAttempt(0);
    return () => window.clearTimeout(retryTimer.current);
  }, [src]);
  const fail = () => {
    if (attemptRef.current < RETRIES) {
      const next = attemptRef.current + 1;
      retryTimer.current = window.setTimeout(() => setAttempt(next), 500 * next);
    } else {
      setFailed(true);
    }
  };
  // בניסיון-חוזר מוסיפים פרמטר לעקיפת מטמון (מרכיב מדיה — לא fetch), כדי לאלץ
  // משיכה טרייה של הנכס שנכשל רגעית.
  const loadSrc = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}_retry=${attempt}`;

  // ---- עצירה בזמן שכבה חוסמת + חיווי טעינה ----
  const elRef = useRef<HTMLMediaElement | null>(null);
  const pausedByOverlay = useContext(MediaPauseContext);
  const forceMuted = useContext(MediaMutedContext);
  const startedAt = useContext(MediaClockContext);
  /** האם *אנחנו* עצרנו — כדי לא להפעיל מחדש וידאו שנגמר או שהמנחה עצר. */
  const overlayPausedRef = useRef(false);
  /**
   * "ממתין לנתונים": הנגן מציג פריים קפוא כי הבאפר ריק. קורה בתחילת סרטון כבד
   * (עד שיש מספיק כדי להתחיל) וגם באמצע נגינה כשהבאפר נגמר. בלי חיווי זה נראה
   * כאילו המשחק נתקע — לכן מציגים עיגול טעינה מעל המדיה.
   */
  const [buffering, setBuffering] = useState(kind === 'video' || kind === 'audio');
  useEffect(() => {
    setBuffering(kind === 'video' || kind === 'audio');
  }, [loadSrc, kind]);

  const attachMedia = useCallback(
    (node: HTMLMediaElement | null) => {
      elRef.current = node;
      // רקע = מושתק. התכונה muted ב-JSX אינה אמינה ל-autoplay (React מגדיר אותה
      // כ-attribute ולא כ-property בזמן, אז הדפדפן עלול להתחיל לנגן *עם* קול);
      // לכן מגדירים muted ישירות על ה-DOM ברגע שהמרכיב נוצר.
      if (node && node instanceof HTMLVideoElement) node.muted = asBackground || forceMuted;
      else if (node && node instanceof HTMLAudioElement && forceMuted) node.muted = true;
    },
    [asBackground, forceMuted],
  );

  // מסך הצפייה: הצופה הפעיל/כיבה צליל באמצע — מעדכנים את הנגן הקיים במקום
  // להחליף אותו (החלפה הייתה מתחילה את הסרטון מההתחלה).
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (el instanceof HTMLVideoElement) el.muted = asBackground || forceMuted;
    else if (el instanceof HTMLAudioElement) el.muted = forceMuted;
  }, [forceMuted, asBackground, loadSrc]);

  // מסך הצפייה: מי שנכנס באמצע סרטון קופץ לנקודה שבה המסך הראשי נמצא.
  useEffect(() => {
    const el = elRef.current;
    if (!el || asBackground || startedAt === null) return undefined;
    const seek = () => {
      const offset = (Date.now() - startedAt) / 1000;
      if (offset > 1.5 && Number.isFinite(el.duration) && offset < el.duration - 0.5) el.currentTime = offset;
    };
    if (el.readyState >= 1) {
      seek();
      return undefined;
    }
    el.addEventListener('loadedmetadata', seek, { once: true });
    return () => el.removeEventListener('loadedmetadata', seek);
  }, [loadSrc, startedAt, asBackground]);

  // מנוי לאירועי הבאפר של הנגן — מקור אמת ישיר, בלי ניחושים לפי זמן.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    const wait = () => setBuffering(true);
    const go = () => setBuffering(false);
    el.addEventListener('waiting', wait);
    el.addEventListener('stalled', wait);
    el.addEventListener('playing', go);
    el.addEventListener('canplay', go);
    el.addEventListener('canplaythrough', go);
    el.addEventListener('ended', go);
    return () => {
      el.removeEventListener('waiting', wait);
      el.removeEventListener('stalled', wait);
      el.removeEventListener('playing', go);
      el.removeEventListener('canplay', go);
      el.removeEventListener('canplaythrough', go);
      el.removeEventListener('ended', go);
    };
  }, [loadSrc, kind]);

  // עצירה/המשך לפי השכבה החוסמת — ממשיכים בדיוק מאותה נקודה.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (pausedByOverlay) {
      if (!el.paused && !el.ended) {
        overlayPausedRef.current = true;
        el.pause();
      }
    } else if (overlayPausedRef.current) {
      overlayPausedRef.current = false;
      void el.play().catch(() => {
        /* חסימת autoplay — נשאר עצור, המנחה ימשיך ידנית */
      });
    }
  }, [pausedByOverlay, loadSrc]);

  /** עיגול הטעינה שמוצג מעל המדיה בזמן המתנה לנתונים (לא על רקע — מכער). */
  const spinner =
    buffering && !asBackground ? (
      <div className="media-buffering" role="status" aria-label="טוען מדיה">
        <span className="media-buffering-ring" />
      </div>
    ) : null;
  if (failed) {
    if (asBackground) return null;
    return (
      <div className="media-error" role="alert">
        <div className="media-error-icon">⚠️</div>
        <p>המדיה לא נטענה</p>
        <p className="media-error-src" dir="ltr">
          {shortName(src)}
        </p>
        <p className="media-error-hint">רווח להמשך</p>
      </div>
    );
  }

  switch (kind) {
    case 'image':
      return <img key={loadSrc} className={className ?? 'media-fill'} src={loadSrc} alt="" onError={fail} />;
    case 'video':
      return (
        <>
          <video
            key={loadSrc}
            ref={attachMedia}
            className={className ?? 'media-fill'}
            src={loadSrc}
            autoPlay
            // מבקשים מהדפדפן לצבור באפר קדימה ולא רק "מספיק כדי להתחיל" —
            // פחות עצירות באמצע. הבייטים ממילא מגיעים מהמטמון המקומי.
            preload="auto"
            muted={asBackground}
            loop={asBackground}
            playsInline
            onEnded={asBackground ? undefined : onEnded}
            onError={fail}
          />
          {spinner}
        </>
      );
    case 'audio':
      return (
        <div className={className ?? 'media-audio'}>
          <div className="media-audio-icon">🎵</div>
          <audio
            key={loadSrc}
            ref={attachMedia}
            src={loadSrc}
            autoPlay
            preload="auto"
            loop={asBackground}
            onEnded={asBackground ? undefined : onEnded}
            onError={fail}
          />
          {spinner}
        </div>
      );
    case 'youtube':
      return (
        <YouTubeEmbed
          src={src}
          className={className}
          // ברקע לא מסירים את הסרטון על שתיקת הנגן — ראו youtubeHandshake.ts.
          {...(asBackground ? {} : { onFailed: () => setFailed(true) })}
          {...(onEnded && !asBackground ? { onEnded } : {})}
        />
      );
    default:
      // סוג שלא זוהה (למשל קישור Drive/Dropbox/Vimeo, או כתובת בלי סיומת).
      // קודם הוצגה כאן הכתובת החשופה על המסך הגדול — מכוער באמצע אירוע, ובלי
      // לומר למנחה מה לעשות.
      if (asBackground) return null;
      return (
        <div className="media-error" role="alert">
          <div className="media-error-icon">⚠️</div>
          <p>סוג המדיה לא זוהה</p>
          <p className="media-error-src" dir="ltr">
            {shortName(src)}
          </p>
          <p className="media-error-hint">רווח להמשך</p>
        </div>
      );
  }
}

/**
 * נגן YouTube דרך iframe עם enablejsapi=1. זיהוי סיום דרך פרוטוקול
 * ה-postMessage של הנגן (playerState === 0), בלי לטעון סקריפט חיצוני.
 *
 * אותו ערוץ משמש גם לזיהוי *כשל*: iframe אינו יורה onError כשההטמעה נדחית,
 * ולכן היעדר תשובה מהנגן הוא הסימן היחיד שמשהו השתבש.
 */
function YouTubeEmbed({
  src,
  onEnded,
  onFailed,
  className,
}: {
  src: string;
  onEnded?: (() => void) | undefined;
  /** הנגן לא ענה — ראו ALIVE_TIMEOUT_MS ב-youtubeHandshake.ts. */
  onFailed?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const endedRef = useRef(false);
  // מסך הצפייה: מושתק עד שהצופה מפעיל צליל. הפרמטר נקבע פעם אחת (שינוי שלו
  // היה טוען את הסרטון מחדש); שינוי אחר כך עובר כפקודה לנגן.
  const forceMuted = useContext(MediaMutedContext);
  const [mutedAtLoad] = useState(forceMuted);
  const lastMutedRef = useRef(forceMuted);
  useEffect(() => {
    if (lastMutedRef.current === forceMuted) return;
    lastMutedRef.current = forceMuted;
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: forceMuted ? 'mute' : 'unMute', args: [] }),
      '*',
    );
  }, [forceMuted]);
  /**
   * הקריאות החוזרות נשמרות ב-ref ואינן ב-deps של האפקט. בלי זה כל רינדור
   * מחדש (למשל חיווי הטעינה) היה יוצר פונקציה חדשה, האפקט היה רץ שוב, וטיימר
   * הכשל היה מתאפס — כלומר לא יורה לעולם. נתפס בבדיקה.
   */
  const endedCb = useRef(onEnded);
  endedCb.current = onEnded;
  const failedCb = useRef(onFailed);
  failedCb.current = onFailed;

  useEffect(() => {
    endedRef.current = false;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handshake = startYoutubeHandshake({
      send: () => {
        iframe.contentWindow?.postMessage(
          JSON.stringify({ event: 'listening', id: 'trivia-engine' }),
          '*',
        );
      },
      // ברקע אין למי להציג שגיאה, ולהסיר סרטון שאולי מתנגן בפועל רק כי הנגן
      // לא ענה — גרוע מלהשאיר אותו. הכשל מדווח רק בחזית, שם המנחה צריך לדעת.
      onTimeout: () => failedCb.current?.(),
    });

    const handleMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith('youtube.com')) return;
      if (event.source !== iframe.contentWindow) return;
      // כל הודעה מהנגן מוכיחה שהוא באמת שם. iframe אינו יורה onError כשיוטיוב
      // מסרב למסגר, כשהסרטון נמחק/פרטי, או כשבעל הערוץ חסם הטמעה — ולכן זו
      // הדרך היחידה לדעת. בלי זה כל כשל כזה נראה כריבוע אפור בלי שום הסבר.
      handshake.markAlive();
      try {
        const data: unknown = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        const info = (data as { event?: string; info?: { playerState?: number } }) ?? {};
        if (info.event === 'onStateChange' || info.event === 'infoDelivery') {
          const playerState =
            info.event === 'onStateChange'
              ? (data as { info?: number }).info
              : info.info?.playerState;
          if (playerState === 0 && !endedRef.current) {
            endedRef.current = true;
            endedCb.current?.();
          }
        }
      } catch {
        // הודעה לא-JSON — לא שלנו
      }
    };

    // בקשת האזנה לאירועי הנגן: מיד ב-load, ובנוסף שוב ושוב עד התשובה הראשונה
    // (ראו youtubeHandshake.ts). הטיימר של הכשל ארוך בכוונה — רשת איטית באולם
    // עלולה לעכב את ההודעה הראשונה.
    iframe.addEventListener('load', handshake.sendNow);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      iframe.removeEventListener('load', handshake.sendNow);
      handshake.dispose();
    };
  }, [src]);

  // ‎youtube.com/watch‎ מסרב להיות ממוסגר (X-Frame-Options), ולכן כל צורה של
  // קישור מומרת ל-‎/embed/<id>‎. בלי זה המסך הראה ריבוע אפור עם סמל עמוד שבור.
  const embed = youtubeEmbedUrl(src) ?? src;
  const separator = embed.includes('?') ? '&' : '?';
  // ניגון אוטומטי בלבד, בלי שום פקד אינטראקטיבי:
  // controls=0 (בלי פס בקרה), disablekb=1 (בלי מקלדת), fs=0 (בלי מסך מלא),
  // modestbranding=1, iv_load_policy=3 (בלי הערות), rel=0, playsinline=1.
  const params = [
    'enablejsapi=1',
    'autoplay=1',
    'controls=0',
    'disablekb=1',
    'fs=0',
    'modestbranding=1',
    'iv_load_policy=3',
    'rel=0',
    'playsinline=1',
    ...(mutedAtLoad ? ['mute=1'] : []),
  ].join('&');
  const url = `${embed}${separator}${params}`;

  return (
    // עטיפה עם שכבת חסימה שקופה מעל ה-iframe — בולעת כל קליק כדי שלא ניתן
    // יהיה לגעת בסרטון עצמו (קליק על גוף הסרטון עוצר אותו).
    <div className={`youtube-wrap ${className ?? 'media-fill'}`}>
      <iframe
        ref={iframeRef}
        key={src}
        className="youtube-frame"
        src={url}
        title="YouTube"
        allow="autoplay; encrypted-media"
        tabIndex={-1}
        style={{ border: 0 }}
      />
      <div className="youtube-blocker" aria-hidden="true" />
    </div>
  );
}
