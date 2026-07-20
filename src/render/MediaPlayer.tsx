/**
 * נגן מדיה אחיד: מזהה את הסוג לפי ה-URL בלבד (classifyMediaUrl) ומרנדר
 * תמונה / וידאו / אודיו / YouTube iframe. מדווח onEnded בסיום (וידאו/אודיו/
 * YouTube; לתמונה אין "סיום" — המפעיל מקדם ידנית).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyMediaUrl } from '../engine/index.ts';

interface MediaPlayerProps {
  src: string;
  onEnded?: () => void;
  /** רקע: וידאו מושתק בלולאה, בלי דיווח סיום. */
  asBackground?: boolean;
  className?: string;
}

/** שם קובץ קצר לתצוגה בהודעת כשל (בלי query ונתיב ארוך). */
function shortName(src: string): string {
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

  // רקע = מושתק. התכונה muted ב-JSX אינה אמינה ל-autoplay (React מגדיר אותה
  // כ-attribute ולא כ-property בזמן, אז הדפדפן עלול להתחיל לנגן *עם* קול); לכן
  // מגדירים muted ישירות על ה-DOM ברגע שהמרכיב נוצר (callback ref).
  const setVideoMuted = useCallback(
    (node: HTMLVideoElement | null) => {
      if (node) node.muted = asBackground;
    },
    [asBackground],
  );
  if (failed && (kind === 'image' || kind === 'video' || kind === 'audio')) {
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
        <video
          key={loadSrc}
          ref={setVideoMuted}
          className={className ?? 'media-fill'}
          src={loadSrc}
          autoPlay
          muted={asBackground}
          loop={asBackground}
          playsInline
          onEnded={asBackground ? undefined : onEnded}
          onError={fail}
        />
      );
    case 'audio':
      return (
        <div className={className ?? 'media-audio'}>
          <div className="media-audio-icon">🎵</div>
          <audio
            key={loadSrc}
            src={loadSrc}
            autoPlay
            loop={asBackground}
            onEnded={asBackground ? undefined : onEnded}
            onError={fail}
          />
        </div>
      );
    case 'youtube':
      return <YouTubeEmbed src={src} className={className} {...(onEnded && !asBackground ? { onEnded } : {})} />;
    default:
      return (
        <div className={className ?? 'media-unknown'}>
          <p dir="ltr">{src}</p>
        </div>
      );
  }
}

/**
 * נגן YouTube דרך iframe עם enablejsapi=1. זיהוי סיום דרך פרוטוקול
 * ה-postMessage של הנגן (playerState === 0), בלי לטעון סקריפט חיצוני.
 */
function YouTubeEmbed({
  src,
  onEnded,
  className,
}: {
  src: string;
  onEnded?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const endedRef = useRef(false);

  useEffect(() => {
    endedRef.current = false;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith('youtube.com')) return;
      if (event.source !== iframe.contentWindow) return;
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
            onEnded?.();
          }
        }
      } catch {
        // הודעה לא-JSON — לא שלנו
      }
    };

    // בקשת האזנה לאירועי הנגן
    const listen = () => {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 'trivia-engine' }),
        '*',
      );
    };
    iframe.addEventListener('load', listen);
    const timer = window.setTimeout(listen, 1500); // fallback אם load כבר קרה

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      iframe.removeEventListener('load', listen);
      window.clearTimeout(timer);
    };
  }, [src, onEnded]);

  const separator = src.includes('?') ? '&' : '?';
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
  ].join('&');
  const url = `${src}${separator}${params}`;

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
