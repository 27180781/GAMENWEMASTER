/**
 * מדריך הווידאו לתוכנת האופליין. הסרטונים מצורפים לתוכנה עצמה (public/guide),
 * ולכן הם עובדים גם בלי אינטרנט — מה שנדרש באירוע.
 *
 * רשימת הפרקים נטענת מ-guide/index.json, שנכתב על ידי סקריפט ההקלטה
 * (tools/guide/record.mjs). כך פרק שיתווסף יופיע כאן בלי לגעת בקוד.
 */

import { useEffect, useRef, useState } from 'react';

export interface GuideChapter {
  slug: string;
  index: string;
  name: string;
  blurb: string;
  file: string;
}

/** נתיב יחסי לבנייה — עובד גם מ-file:// באלקטרון וגם משרת. */
const BASE = 'guide/';

interface GuideScreenProps {
  onClose: () => void;
}

export function GuideScreen({ onClose }: GuideScreenProps) {
  const [chapters, setChapters] = useState<GuideChapter[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${BASE}index.json`)
      .then((r) => (r.ok ? (r.json() as Promise<GuideChapter[]>) : Promise.reject(new Error('404'))))
      .then((list) => {
        if (!alive) return;
        setChapters(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // ESC סוגר — כמו בשאר החלוניות של התוכנה.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chapter = chapters?.[current];

  /** מעבר לפרק אחר — מנגן אותו מיד, כדי שהבחירה תרגיש מיידית. */
  const pick = (i: number) => {
    setCurrent(i);
    // הווידאו מקבל key חדש ולכן נטען מחדש; ההפעלה נעשית ב-onLoadedData.
  };

  return (
    <div className="screen settings-screen guide-screen" dir="rtl">
      <header className="guide-bar">
        <h1 className="guide-title">🎬 מדריך שימוש</h1>
        <span className="guide-spacer" />
        <button type="button" className="guide-close" onClick={onClose}>
          ✕ סגירה
        </button>
      </header>

      {failed && (
        <p className="guide-missing">
          קובצי המדריך לא נמצאו בגרסה הזו. הורידו את הגרסה העדכנית של התוכנה.
        </p>
      )}

      {chapters !== null && chapters.length > 0 && chapter !== undefined && (
        <div className="guide-body">
          <ol className="guide-list">
            {chapters.map((c, i) => (
              <li key={c.slug}>
                <button
                  type="button"
                  className={i === current ? 'guide-item guide-item--on' : 'guide-item'}
                  onClick={() => pick(i)}
                >
                  <span className="guide-item-index">{c.index}</span>
                  <span className="guide-item-text">
                    <span className="guide-item-name">{c.name}</span>
                    <span className="guide-item-blurb">{c.blurb}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div className="guide-player">
            <video
              ref={videoRef}
              key={chapter.slug}
              className="guide-video"
              src={`${BASE}${chapter.file}`}
              controls
              autoPlay
              playsInline
            />
            <p className="guide-caption">
              <b>
                {chapter.index} · {chapter.name}
              </b>
              {' — '}
              {chapter.blurb}
            </p>
            {current < chapters.length - 1 && (
              <button type="button" className="guide-next" onClick={() => pick(current + 1)}>
                הפרק הבא ←
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
