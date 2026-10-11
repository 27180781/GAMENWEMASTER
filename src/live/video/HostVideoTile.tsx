/**
 * וידאו המנחה במסך הצפייה: החיבור (`useHostVideoReceiver`) והחלון שליד המסך
 * (`HostVideoTile`). החלון מוצג כשמצב המסך מכריז על שידור (`snap.video`),
 * והצופה יכול להסתיר אותו — אז גם החיבור נסגר, והמקום שלו בתקרת הצופים מתפנה.
 */

import { useEffect, useRef, useState } from 'react';
import type { LiveVideo } from './api.ts';
import {
  hostVideoElement,
  retryHostPlayback,
  showHostStream,
  type Playback,
} from './hostVideoElement.ts';
import { HostVideoReceiver, RECEIVER_IDLE, type ReceiverState } from './viewerVideo.ts';

/** מתחבר לשידור `gen` כל עוד הוא לא null, ומתחבר מחדש כשהוא מתחלף. */
export function useHostVideoReceiver(
  relayBase: string,
  viewToken: string,
  gen: string | null,
): ReceiverState {
  const [state, setState] = useState<ReceiverState>(RECEIVER_IDLE);
  const receiverRef = useRef<HostVideoReceiver | null>(null);
  const genRef = useRef(gen);
  genRef.current = gen;

  useEffect(() => {
    const receiver = new HostVideoReceiver({ relayBase, viewToken, onState: setState });
    receiverRef.current = receiver;
    // יציאה מהדף: לפנות את המקום מיד (sendBeacon). חזרה מהמטמון של הדפדפן — שוב.
    const onPageHide = () => receiver.stop();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && genRef.current !== null) receiver.start();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      receiver.stop();
      receiverRef.current = null;
    };
  }, [relayBase, viewToken]);

  useEffect(() => {
    const receiver = receiverRef.current;
    if (receiver === null) return;
    if (gen === null) {
      receiver.stop();
      return;
    }
    const current = receiver.current;
    // כבר מחובר לשידור הזה (התחבר לבד אחרי שהמנחה פתח שידור חדש).
    if (current.phase === 'playing' && current.gen === gen) return;
    receiver.start();
  }, [gen, relayBase, viewToken]);

  return state;
}

function statusText(phase: ReceiverState['phase']): string | null {
  switch (phase) {
    case 'idle':
    case 'connecting':
      return 'מתחברים לווידאו של המנחה…';
    case 'waiting':
      return 'ממתינים לווידאו של המנחה…';
    case 'full':
      return 'הצפייה בווידאו מלאה כרגע. מנסים שוב בעוד רגע…';
    case 'playing':
    case 'unavailable':
      return null;
  }
}

/**
 * החלון עצמו. רכיב ה-<video> משותף לכל הדף (hostVideoElement.ts) ועובר לכאן
 * כשהחלון מוצג, כדי שהקול שהצופה הפעיל יישאר מופעל.
 */
export function HostVideoTile({
  receiver,
  video,
  soundOn,
  onHide,
}: {
  receiver: ReceiverState;
  video: LiveVideo;
  soundOn: boolean;
  onHide: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [playback, setPlayback] = useState<Playback>('ok');

  useEffect(() => {
    const el = hostVideoElement();
    holder.current?.appendChild(el);
    return () => el.remove();
  }, []);

  const stream = receiver.phase === 'playing' ? receiver.stream : null;
  useEffect(() => {
    let cancelled = false;
    void showHostStream(stream).then((result) => {
      if (!cancelled) setPlayback(result);
    });
    return () => {
      cancelled = true;
    };
  }, [stream, soundOn]);

  const retry = () => {
    void retryHostPlayback().then(setPlayback);
  };

  const status = statusText(receiver.phase);
  const playing = status === null && stream !== null;
  const camOff = playing && !video.cam;
  return (
    <div className={`live-video${playing && video.cam ? ' is-playing' : ''}`} dir="rtl">
      <div className="live-video-frame" ref={holder} />
      {status !== null && (
        <div className="live-video-cover" role="status">
          <span className="spinner" />
          <span>{status}</span>
        </div>
      )}
      {camOff && (
        <div className="live-video-cover">
          <span className="live-video-cover-icon">{video.mic ? '🎙️' : '⏸️'}</span>
          <span>{video.mic ? 'המצלמה של המנחה כבויה' : 'המצלמה והמיקרופון של המנחה כבויים'}</span>
        </div>
      )}
      {playing && playback === 'blocked' && (
        <button type="button" className="live-video-cover live-video-tap" onClick={retry}>
          <span className="live-video-cover-icon">▶️</span>
          <span>הקישו להצגת הווידאו של המנחה</span>
        </button>
      )}
      <span className="live-video-label">המנחה{playing && !video.mic ? ' · 🔇' : ''}</span>
      {/* הצליל דלוק והדפדפן בכל זאת סירב לקול (בלי «הפעלת צליל» — הכפתור
          הרגיל, שמתחת לחלון, מדליק גם את המנחה) */}
      {playing && video.mic && soundOn && playback === 'muted' && (
        <button
          type="button"
          className="live-video-sound"
          onClick={retry}
          title="הפעלת הקול של המנחה"
        >
          🔇 לשמוע את המנחה
        </button>
      )}
      <button type="button" className="live-video-hide" onClick={onHide} title="הסתרת הווידאו">
        ✕
      </button>
    </div>
  );
}
