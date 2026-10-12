/**
 * חלון אחד של מצלמת משתתף ב«במה» — אצל הצופים, בחלונית הבמה של המסך הראשי
 * ובתצוגה המקדימה של המנחה. בלי קול (המצלמות של המשתתפים בלי מיקרופון), ולכן
 * תמיד מושתק ומתנגן לבד.
 *
 * כשהבמה משתנה הצופה עובר לחיבור חדש, והתמונה של כל מצלמה מגיעה בו מחדש. שני
 * רכיבי וידאו: הישן ממשיך להיות מוצג עד שבחדש יש תמונה (stage.ts, `videoSlotsStep`),
 * כך שמי שכבר על הבמה לא נעלם לרגע כשמישהו נוסף עולה.
 *
 * טלפון לאורך שולח תמונה גבוהה: היא מוצגת שלמה (עם שוליים), ולא חתוכה לפס
 * באמצע הפנים כמו שהייתה נחתכת לחלון רחב.
 */

import { useEffect, useReducer, useRef } from 'react';
import {
  initialVideoSlots,
  VIDEO_SWAP_TIMEOUT_MS,
  videoSlotsStep,
  type VideoSlots,
  type VideoSlotsAction,
} from './stage.ts';

const step = (view: VideoSlots<MediaStream>, action: VideoSlotsAction<MediaStream>) =>
  videoSlotsStep(view, action);
const initial = (stream: MediaStream | null) => initialVideoSlots(stream);

function attach(el: HTMLVideoElement | null, stream: MediaStream | null): void {
  if (el === null) return;
  if (el.srcObject !== stream) el.srcObject = stream;
  if (stream !== null) void el.play().catch(() => {});
}

export function StageVideo({
  stream,
  mirror = false,
}: {
  stream: MediaStream | null;
  /** המצלמה של המשתתף עצמו — כמו מראה. */
  mirror?: boolean;
}) {
  const [view, dispatch] = useReducer(step, stream, initial);
  const first = useRef<HTMLVideoElement>(null);
  const second = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    dispatch({ type: 'stream', stream });
  }, [stream]);

  const [a, b] = view.slots;
  useEffect(() => attach(first.current, a.stream), [a.stream]);
  useEffect(() => attach(second.current, b.stream), [b.stream]);

  // מתי יש תמונה, ובאיזה כיוון — לכל רכיב, לפי מה שהוא מנגן עכשיו.
  useEffect(() => {
    const off = [first, second].map((ref, i) => {
      const el = ref.current;
      if (el === null) return () => {};
      const slot = i === 0 ? 0 : 1;
      const update = () => {
        const current = el.srcObject as MediaStream | null;
        if (current === null) return;
        dispatch({
          type: 'frame',
          slot,
          stream: current,
          ready: el.videoWidth > 0,
          portrait: el.videoHeight > el.videoWidth,
        });
      };
      const events = ['resize', 'loadedmetadata', 'playing'] as const;
      events.forEach((name) => el.addEventListener(name, update));
      return () => events.forEach((name) => el.removeEventListener(name, update));
    });
    return () => off.forEach((fn) => fn());
  }, []);

  // בחדש עוד אין תמונה אחרי כמה שניות — עוברים אליו בכל זאת.
  const pending = view.slots[view.front === 0 ? 1 : 0].stream;
  useEffect(() => {
    if (pending === null) return undefined;
    const timer = setTimeout(() => dispatch({ type: 'swap' }), VIDEO_SWAP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  return (
    <>
      {[first, second].map((ref, i) => {
        const slot = view.slots[i === 0 ? 0 : 1];
        const shown = i === view.front && slot.ready;
        const className = `stage-video${slot.portrait ? ' is-portrait' : ''}${mirror ? ' is-mirror' : ''}${shown ? ' is-shown' : ''}`;
        return <video key={i} ref={ref} className={className} autoPlay playsInline muted />;
      })}
    </>
  );
}
