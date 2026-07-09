/**
 * שקופית subject: טקסט לתצוגה, או פקודת מערכת (SPEC סעיף 4):
 * - dynamic-image: תמונה מהשרת במסך מלא, עם retry + backoff והודעת המתנה.
 * - send-data: מסך ביניים ניטרלי ("מעבד נתונים..."); השליחה עצמה מחוץ
 *   ל-scope של M2 (אין עדיין מערכת חיצונית — SPEC סעיף 11).
 */

import { useEffect, useState } from 'react';
import type { Slide, SubjectCommand } from '../engine/index.ts';

export function SubjectSlide({ slide, command }: { slide: Slide; command: SubjectCommand }) {
  if (command?.kind === 'dynamic-image') {
    return <DynamicImage url={command.url} />;
  }
  if (command?.kind === 'send-data') {
    return (
      <div className="subject-slide subject-slide--processing">
        <div className="spinner" />
        <p>מעבד נתונים...</p>
      </div>
    );
  }
  return (
    <div className="subject-slide">
      <p className="subject-text">{slide.question.que}</p>
    </div>
  );
}

/** תמונה דינמית עם retry + exponential backoff (עד 5 ניסיונות). */
function DynamicImage({ url }: { url: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [url]);

  const handleError = () => {
    if (attempt >= 4) {
      setFailed(true);
      return;
    }
    const delay = 1000 * 2 ** attempt; // 1s → 2s → 4s → 8s
    window.setTimeout(() => setAttempt((n) => n + 1), delay);
  };

  if (failed) {
    return (
      <div className="subject-slide subject-slide--processing">
        <p>לא ניתן לטעון את התמונה מהשרת</p>
        <p dir="ltr" className="subject-url">{url}</p>
      </div>
    );
  }

  return (
    <div className="subject-slide subject-slide--image">
      {/* פרמטר attempt שובר cache בניסיון חוזר */}
      <img
        key={attempt}
        className="media-fill"
        src={attempt === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`}
        alt=""
        onError={handleError}
      />
      {attempt > 0 && <p className="subject-waiting">ממתין לנתונים מהשרת...</p>}
    </div>
  );
}
