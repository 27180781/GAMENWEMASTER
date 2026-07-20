/**
 * מסך שגיאה עצמאי — מוצג כשטעינת קובץ המשחק נכשלה: קישור שגוי, שרת שנפל, או
 * קובץ לא תקין (למשל סקר בלי תשובות). מחליף את מסך "בחירת קובץ המשחק" כדי
 * שהמנחה יראה בבירור *מה* נכשל, בלי בוררי-הבדיקה שאינם רלוונטיים באירוע חי.
 */

interface ErrorScreenProps {
  message: string;
  /** טעינה מחדש — מוצג רק כשנטענו מקישור ‎?game=URL‎ (כשל זמני של שרת/רשת). */
  onRetry?: (() => void) | undefined;
  /** חזרה לבחירת קובץ — מוצג בפיתוח מקומי / בורר קבצים (בלי קישור משחק). */
  onBack?: (() => void) | undefined;
}

export function ErrorScreen({ message, onRetry, onBack }: ErrorScreenProps) {
  return (
    <div className="screen error-screen">
      <div className="screen-content error-content">
        <div className="error-icon">⚠️</div>
        <h1 className="error-title">לא ניתן לפתוח את המשחק</h1>
        <pre className="error-detail" dir="rtl">
          {message}
        </pre>
        {(onRetry || onBack) && (
          <div className="error-actions">
            {onRetry && (
              <button className="error-btn error-btn--primary" onClick={onRetry}>
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
