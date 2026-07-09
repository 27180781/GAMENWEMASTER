/**
 * נגן מדיה אחיד: מזהה את הסוג לפי ה-URL בלבד (classifyMediaUrl) ומרנדר
 * תמונה / וידאו / אודיו / YouTube iframe. מדווח onEnded בסיום (וידאו/אודיו/
 * YouTube; לתמונה אין "סיום" — המפעיל מקדם ידנית).
 */

import { useEffect, useRef } from 'react';
import { classifyMediaUrl } from '../engine/index.ts';

interface MediaPlayerProps {
  src: string;
  onEnded?: () => void;
  /** רקע: וידאו מושתק בלולאה, בלי דיווח סיום. */
  asBackground?: boolean;
  className?: string;
}

export function MediaPlayer({ src, onEnded, asBackground = false, className }: MediaPlayerProps) {
  const kind = classifyMediaUrl(src);

  switch (kind) {
    case 'image':
      return <img className={className ?? 'media-fill'} src={src} alt="" />;
    case 'video':
      return (
        <video
          key={src}
          className={className ?? 'media-fill'}
          src={src}
          autoPlay
          muted={asBackground}
          loop={asBackground}
          playsInline
          onEnded={asBackground ? undefined : onEnded}
        />
      );
    case 'audio':
      return (
        <div className={className ?? 'media-audio'}>
          <div className="media-audio-icon">🎵</div>
          <audio key={src} src={src} autoPlay loop={asBackground} onEnded={asBackground ? undefined : onEnded} />
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
  const url = `${src}${separator}enablejsapi=1&autoplay=1&rel=0`;

  return (
    <iframe
      ref={iframeRef}
      key={src}
      className={className ?? 'media-fill'}
      src={url}
      title="YouTube"
      allow="autoplay; encrypted-media"
      allowFullScreen
      style={{ border: 0 }}
    />
  );
}
