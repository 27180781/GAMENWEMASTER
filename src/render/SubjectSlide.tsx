/**
 * שקופית subject: טקסט לתצוגה, או פקודת מערכת (SPEC סעיף 4):
 * - dynamic-image: תמונה מהשרת במסך מלא, עם retry + backoff והודעת המתנה.
 * - send-data: מסך ביניים ניטרלי ("מעבד נתונים..."); השליחה עצמה מחוץ
 *   ל-scope של M2 (אין עדיין מערכת חיצונית — SPEC סעיף 11).
 */

import { useEffect, useState } from 'react';
import { isImageQuestion, type Slide, type SubjectCommand } from '../engine/index.ts';
import { VILLA_DOUBLE_MAX_TICKETS, doubleIntroLines } from '../app/villaDouble.ts';
import { FitText } from './FitText.tsx';
import { displayText } from './multiline.ts';

export function SubjectSlide({ slide, command }: { slide: Slide; command: SubjectCommand }) {
  // מסך ההכרזה שלפני שאלת דאבל של הגרלת הווילה (villaDouble.ts). הנוסח כאן ולא
  // ב-que: que הוא הנוסח למנוע ישן, שמציג אותו כשקופית טקסט רגילה.
  if (slide.doubleIntro !== undefined) {
    return <DoubleIntro n={slide.doubleIntro.n} of={slide.doubleIntro.of} tickets={slide.doubleIntro.tickets} />;
  }
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
  // שקופית כותרת שנוסחה הוא תמונה — התמונה היא התוכן, במסך מלא.
  if (isImageQuestion(slide.question)) {
    return (
      <div className="subject-slide subject-slide--image">
        <img className="subject-image" src={slide.question.src} alt="" />
      </div>
    );
  }
  return (
    <div className="subject-slide">
      {/* FitText מקטין עד שהטקסט כולו נכנס בתקציב הגובה, במקום לקצץ את סופו. */}
      <FitText className="subject-text" min={16}>
        {displayText(slide.question.que)}
      </FitText>
    </div>
  );
}

/** «שאלת דאבל 3 מתוך 10»: תג מבריק, נקודה לכל שאלת דאבל במשחק, ומה היא שווה. */
function DoubleIntro({ n, of, tickets }: { n: number; of: number; tickets: boolean }) {
  const text = doubleIntroLines({ n, of, tickets });
  return (
    <div className="subject-slide double-intro" dir="rtl">
      <div className="double-intro-badge">
        <span className="double-intro-icon">🎫</span>
        <span className="double-intro-title">{text.title}</span>
      </div>
      <div className="double-intro-counter">{text.counter}</div>
      <div className="double-intro-dots" aria-hidden="true">
        {Array.from({ length: Math.min(of, VILLA_DOUBLE_MAX_TICKETS * 2) }, (_, i) => (
          <span
            key={i}
            className={`double-intro-dot${i < n - 1 ? ' double-intro-dot--done' : i === n - 1 ? ' double-intro-dot--now' : ''}`}
          />
        ))}
      </div>
      {text.lines.map((line, i) => (
        <p key={i} className={`double-intro-line${i === 0 ? ' double-intro-line--lead' : ''}`}>
          {line}
        </p>
      ))}
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
