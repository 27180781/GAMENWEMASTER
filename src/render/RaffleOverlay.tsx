/**
 * הגרלת משתתף (מקש R) — שכבה מעל המשחק שמריצה "גלגל" שמות במהירות ונעצר
 * בהדרגה על המשתתף שהוגרל.
 *
 * המוגרל נבחר *לפני* האנימציה (הגרלה הוגנת אחת), והאנימציה היא תצוגה בלבד:
 * כך אין תלות בין משך הריצה לתוצאה, ואי אפשר "להשפיע" על ההגרלה בעצירה.
 */

import { useEffect, useRef, useState } from 'react';

/** משתתף במאגר ההגרלה: המזהה (מספר שלט / טלפון) והשם להצגה. */
export interface RaffleEntry {
  id: string;
  name: string;
}

/** משך ה"גלגל" ומספר ההחלפות — נבחרו כך שההאטה נראית טבעית על מסך גדול. */
const SPIN_MS = 4200;
const TICKS = 30;

/**
 * לוח הזמנים בין ההחלפות: קצר בהתחלה וגדל בקצב קובייתי, מנורמל לאורך קבוע.
 * כך ההתחלה מהירה מאוד והסוף איטי ומתוח — בלי לתלות את המשך במספר ההחלפות.
 */
export function spinSchedule(ticks = TICKS, durationMs = SPIN_MS): number[] {
  const raw = Array.from({ length: ticks }, (_, i) => 1 + 14 * (i / Math.max(1, ticks - 1)) ** 3);
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((r) => (r / total) * durationMs);
}

export function RaffleOverlay({
  entries,
  winner,
  onClose,
}: {
  entries: RaffleEntry[];
  winner: RaffleEntry;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState<RaffleEntry>(entries[0] ?? winner);
  const [done, setDone] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // מאגר של אחד (או ריק) — אין מה לגלגל, מציגים מיד.
    if (entries.length <= 1) {
      setCurrent(winner);
      setDone(true);
      return;
    }
    setCurrent(entries[0] ?? winner);
    setDone(false);
    const gaps = spinSchedule();
    let i = 0;
    const step = () => {
      i += 1;
      if (i >= gaps.length) {
        setCurrent(winner);
        setDone(true);
        return;
      }
      setCurrent((prev) => {
        // לא מציגים את אותו שם פעמיים ברצף, ולא את המוגרל לפני הסוף — אחרת
        // התוצאה "מתגלה" באמצע והמתח נשבר.
        for (let t = 0; t < 10; t++) {
          const pick = entries[Math.floor(Math.random() * entries.length)];
          if (pick !== undefined && pick.id !== prev.id && pick.id !== winner.id) return pick;
        }
        return prev;
      });
      timerRef.current = window.setTimeout(step, gaps[i]);
    };
    timerRef.current = window.setTimeout(step, gaps[0]);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [entries, winner]);

  const showId = current.id !== '' && current.id !== current.name;
  return (
    <div className="raffle-overlay" onClick={onClose}>
      <div className={`raffle-box${done ? ' raffle-box--done' : ''}`}>
        <div className="raffle-title">🎲 הגרלה</div>
        <div className={`raffle-name${done ? ' raffle-name--done' : ''}`}>{current.name}</div>
        {showId && (
          <div className="raffle-id" dir="ltr">
            {current.id}
          </div>
        )}
        <div className="raffle-hint">
          {done ? 'R / רווח — חזרה למשחק · R שוב — הגרלה נוספת' : 'מגריל…'}
        </div>
      </div>
    </div>
  );
}
