/**
 * סדר הפרקים במדריך. פרק חדש = קובץ ב-chapters/ ושורה כאן; מסך הסרטונים
 * בתוכנה בונה את הרשימה מ-index.json שההקלטה כותבת, ולא צריך שינוי.
 */

export const CHAPTERS = [
  '01-intro.mjs',
  '02-source.mjs',
  '03-receiver.mjs',
  '04-names.mjs',
  '05-play.mjs',
  '06-computer.mjs',
  '07-editor.mjs',
  '08-new-game.mjs',
];

/** "פרק 3 מתוך 8" לכרטיס הפתיחה — נגזר מהרשימה, כדי שלא יתיישן כשמוסיפים פרק. */
export function ofTotal(meta) {
  return `${meta.index} מתוך ${CHAPTERS.length}`;
}
