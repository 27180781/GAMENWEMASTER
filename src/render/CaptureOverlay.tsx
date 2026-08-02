/**
 * החלונית הגדולה של "קליטת שלטים בלחיצה": בכל לחיצה מוצג מספר השלט שנקלט
 * והשם ששובץ לו — ואם אין שם פנוי, "ממתין לשיוך". זה המשוב שמאפשר לעבור על
 * חדר שלם ולראות בוודאות שכל שלט נקלט.
 */

export interface CaptureFlash {
  id: string;
  name: string;
  /** false = השלט כבר היה ברשימה (לחיצה חוזרת) — מוצג אחרת. */
  isNew: boolean;
  /** מונה עולה — כדי שגם לחיצה זהה ברצף תיראה כאירוע חדש. */
  seq: number;
}

interface CaptureOverlayProps {
  flash: CaptureFlash | null;
  /** כמה שלטים נקלטו עד כה. */
  total: number;
  /** כמה שמות ממתינים לשלט. */
  waitingNames: number;
  /** מגירת השמות פתוחה — מתמקמים לצידה במקום מתחתיה. */
  aside: boolean;
  onStop: () => void;
}

export function CaptureOverlay({ flash, total, waitingNames, aside, onStop }: CaptureOverlayProps) {
  return (
    <div className={aside ? 'capture-overlay capture-overlay--aside' : 'capture-overlay'} dir="rtl">
      <div className="capture-box">
        <div className="capture-title">🎯 קליטת שלטים</div>
        {flash === null ? (
          <div className="capture-wait">לחצו על שלט כדי לקלוט אותו…</div>
        ) : (
          <div className={flash.isNew ? 'capture-hit' : 'capture-hit capture-hit--again'}>
            <div className="capture-id">{flash.id}</div>
            {flash.name.trim() === '' ? (
              <div className="capture-name capture-name--none">ממתין לשיוך</div>
            ) : (
              <div className="capture-name">{flash.name}</div>
            )}
            {!flash.isNew && <div className="capture-again">כבר נקלט</div>}
          </div>
        )}
        <div className="capture-stats">
          נקלטו {total} שלטים
          {waitingNames > 0 ? ` · ${waitingNames} שמות ממתינים` : ''}
        </div>
        <button className="capture-stop" onClick={onStop}>
          ⏹ סיום קליטה
        </button>
      </div>
    </div>
  );
}
