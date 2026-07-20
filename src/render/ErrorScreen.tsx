/**
 * מסך שגיאה/אזהרה עצמאי בטעינת קובץ המשחק. מחליף את מסך "בחירת קובץ המשחק" כדי
 * שהמנחה יראה בבירור *מה* קרה, בלי בוררי-הבדיקה שאינם רלוונטיים באירוע חי:
 *
 *   variant="error"   — כשל קשה שלא ניתן להתאושש ממנו (קישור שגוי, שרת שנפל,
 *                       הגדרות פגומות). מוצג הטקסט המלא של השגיאה.
 *   variant="warning" — נמצאו שקופיות פגומות בודדות (למשל סקר בלי תשובות), אך
 *                       שאר המשחק תקין. מוצגת רשימת השקופיות + כפתור "דלג והמשך"
 *                       כדי לשחק בכל זאת בשאר השקופיות.
 */

/** שקופית פגומה שהוצגה למנחה (מבנה תואם ל-DroppedSlide מה-loader). */
export interface LoadIssue {
  /** מיקום השקופית בקובץ (1-מבוסס). */
  position: number;
  /** מזהה השקופית (id) מהקובץ, אם קיים. */
  id: number | string | null;
  /** ההודעות שהפכו אותה ללא-תקינה. */
  messages: string[];
}

interface ErrorScreenProps {
  variant?: 'error' | 'warning';
  title: string;
  /** טקסט חופשי (מסך שגיאה קשה) — מוצג כ-<pre>. */
  message?: string | undefined;
  /** רשימת שקופיות פגומות (מסך אזהרה). */
  issues?: readonly LoadIssue[] | undefined;
  /** הערת-הנחיה מתחת (למשל "יש לתקן בעמוד יצירת המשחק"). */
  note?: string | undefined;
  /** "דלג והמשך" — מוצג רק כשיש משחק בר-משחק אחרי דילוג. */
  onContinue?: (() => void) | undefined;
  continueLabel?: string | undefined;
  /** טעינה מחדש — מוצג בטעינה מקישור ‎?game=URL‎ (כשל זמני של שרת/רשת). */
  onRetry?: (() => void) | undefined;
  /** חזרה לבחירת קובץ — מוצג בבורר המקומי (בלי קישור משחק). */
  onBack?: (() => void) | undefined;
}

export function ErrorScreen({
  variant = 'error',
  title,
  message,
  issues,
  note,
  onContinue,
  continueLabel = 'המשך בכל זאת',
  onRetry,
  onBack,
}: ErrorScreenProps) {
  return (
    <div className={`screen error-screen error-screen--${variant}`}>
      <div className="screen-content error-content">
        <div className="error-icon">{variant === 'warning' ? '⚠️' : '⛔'}</div>
        <h1 className="error-title">{title}</h1>

        {message !== undefined && (
          <pre className="error-detail" dir="rtl">
            {message}
          </pre>
        )}

        {issues !== undefined && issues.length > 0 && (
          <ul className="error-issues">
            {issues.map((issue) => (
              <li key={issue.position} className="error-issue">
                <span className="error-issue-head">
                  שקופית {issue.position}
                  {issue.id !== null && <span className="error-issue-id"> (id={issue.id})</span>}
                </span>
                <span className="error-issue-msgs">{issue.messages.join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}

        {note !== undefined && <p className="error-note">{note}</p>}

        {(onContinue || onRetry || onBack) && (
          <div className="error-actions">
            {onContinue && (
              <button className="error-btn error-btn--primary" onClick={onContinue}>
                {continueLabel}
              </button>
            )}
            {onRetry && (
              <button
                className={`error-btn ${onContinue ? '' : 'error-btn--primary'}`}
                onClick={onRetry}
              >
                נסה שוב
              </button>
            )}
            {onBack && (
              <button className="error-btn" onClick={onBack}>
                חזרה לבחירת קובץ
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
