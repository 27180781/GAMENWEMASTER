/** מצב הטיימר (SPEC סעיף 9) — נותר/סה"כ ומצב עצירה. התצוגה עצמה מרונדרת
 *  בתוך QuestionSlide (פס q-countdown); כאן רק הטיפוס המשותף. */

export interface TimerView {
  remaining: number;
  total: number;
  /** הטיימר עצור בפקודת מנחה (6) — ההצבעה קפואה. */
  paused: boolean;
}
