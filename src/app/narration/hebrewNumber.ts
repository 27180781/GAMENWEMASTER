/**
 * הרכבת מספרים מקטעי הבנק של הקריין (ENGINE-narration.md סעיף 2.2).
 *
 * **לעולם לא מסנתזים שמע בזמן משחק** — מספר נאמר כרצף של קטעים מוכנים מראש:
 * אלפים → מאות → עשרות/יחידות (1–19 הן יחידה אחת). כל החלקים בלי ו׳ החיבור
 * חוץ מהאחרון, שמקבל את צורת ה-ו׳ (`num_f_v_*` / `num_m_v_*` / `tens_v_*` /
 * `hundreds_v_*`). קבוצת האלפים לעולם אינה מקבלת ו׳ בסופה ("שנים עשר אלף"),
 * אבל *בתוכה* חלה אותה חוקיות ("עשרים ואחד אלף").
 *
 * הפונקציות טהורות ומחזירות **מפתחות בנק** בלבד; מי שממיר אותם לכתובות הוא
 * ה-narrationDirector (מפתח שאינו קיים בבנק מדולג בשקט).
 */

/** מגדר המספר: נקבה לנקודות/שניות/שאלות/תשובות, זכר למשתתפים. */
export type NumberGender = 'f' | 'm';

/** מעל זה אין קטעים להרכיב — המנוע פשוט לא יאמר את המספר. */
const MAX_NUMBER = 99_999;

/** צורת ה-ו׳ של מפתח בודד; null כשאין כזו (למשל קטע אלפים שלם). */
function vavForm(key: string): string | null {
  if (key.startsWith('num_f_') && !key.startsWith('num_f_v_')) {
    return `num_f_v_${key.slice('num_f_'.length)}`;
  }
  if (key.startsWith('num_m_') && !key.startsWith('num_m_v_')) {
    return `num_m_v_${key.slice('num_m_'.length)}`;
  }
  if (key.startsWith('tens_') && !key.startsWith('tens_v_')) {
    return `tens_v_${key.slice('tens_'.length)}`;
  }
  if (key.startsWith('hundreds_') && !key.startsWith('hundreds_v_')) {
    return `hundreds_v_${key.slice('hundreds_'.length)}`;
  }
  return null;
}

/**
 * עשרות ויחידות (1–99) — כשיש גם עשרות וגם יחידות, היחידה תמיד נושאת את ו׳
 * החיבור ("עשרים ואחת"), ולכן היא נסגרת כאן ולא בשכבה שמעל.
 */
function tensAndUnits(value: number, gender: NumberGender): string[] {
  if (value <= 0) return [];
  if (value <= 19) return [`num_${gender}_${value}`];
  const tens = Math.floor(value / 10) * 10;
  const unit = value % 10;
  if (unit === 0) return [`tens_${tens}`];
  return [`tens_${tens}`, `num_${gender}_v_${unit}`];
}

/** 1–999 כקבוצה עצמאית (משמש גם לספירת האלפים, בזכר). */
function under1000(value: number, gender: NumberGender): string[] {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const keys: string[] = [];
  if (hundreds > 0) keys.push(`hundreds_${hundreds * 100}`);
  const tail = tensAndUnits(rest, gender);
  if (hundreds > 0 && tail.length === 1) {
    // "מאה ואחת" — חלק אחרון יחיד מקבל את ו׳ החיבור
    keys.push(vavForm(tail[0]!) ?? tail[0]!);
  } else {
    keys.push(...tail);
  }
  return keys;
}

/** קבוצת האלפים (1–99 אלף) — אינה נושאת ו׳ בסופה. */
function thousandsGroup(count: number): string[] {
  if (count <= 0) return [];
  if (count <= 9) return [`thousands_${count * 1000}`];
  if (count === 10) return ['thousands_10000'];
  if (count <= 19) return [`num_m_${count}`, 'thousands_word'];
  return [...under1000(count, 'm'), 'thousands_word'];
}

/**
 * מפתחות הבנק שמרכיבים את המספר. 0 → "אפס" (גם בזכר), שלילי → הערך המוחלט,
 * שבר → מעוגל, מעל 99,999 → רשימה ריקה (אין מה לומר).
 */
export function numberClipKeys(n: number, gender: NumberGender): string[] {
  if (!Number.isFinite(n)) return [];
  const value = Math.round(Math.abs(n));
  if (value === 0) return ['num_f_0']; // "אפס" — אין צורה נפרדת בזכר
  if (value > MAX_NUMBER) return [];

  const thousands = thousandsGroup(Math.floor(value / 1000));
  const rest = value % 1000;
  const hundreds = Math.floor(rest / 100);
  const hundredsKeys = hundreds > 0 ? [`hundreds_${hundreds * 100}`] : [];
  const tailKeys = tensAndUnits(rest % 100, gender);

  // ו׳ החיבור על החלק האחרון — אבל רק כשקדם לו חלק אחר, ולעולם לא בסוף קבוצת
  // האלפים ("שנים עשר אלף", לא "שנים עשר ואלף"). כשהזנב הוא עשרות+יחידות,
  // ה-ו׳ כבר יושבת על היחידה.
  if (tailKeys.length === 1 && (thousands.length > 0 || hundredsKeys.length > 0)) {
    tailKeys[0] = vavForm(tailKeys[0]!) ?? tailKeys[0]!;
  } else if (tailKeys.length === 0 && hundredsKeys.length === 1 && thousands.length > 0) {
    hundredsKeys[0] = vavForm(hundredsKeys[0]!) ?? hundredsKeys[0]!;
  }

  return [...thousands, ...hundredsKeys, ...tailKeys];
}

/**
 * ניקוד: מספר בנקבה + "נקודות". יוצאי הדופן הם 1 ("נקודה אחת") ו-2 ("שתי
 * נקודות" — צורת הנסמך).
 */
export function pointsClipKeys(n: number): string[] {
  const value = Math.round(Math.abs(n));
  if (value === 1) return ['unit_point_one'];
  if (value === 2) return ['num_f_2_construct', 'unit_points'];
  const keys = numberClipKeys(value, 'f');
  return keys.length === 0 ? [] : [...keys, 'unit_points'];
}

/** משתתפים: מספר בזכר + "משתתפים", עם אותם שני יוצאי הדופן. */
export function participantsClipKeys(n: number): string[] {
  const value = Math.round(Math.abs(n));
  if (value === 1) return ['unit_participant_one'];
  if (value === 2) return ['num_m_2_construct', 'unit_participants'];
  const keys = numberClipKeys(value, 'm');
  return keys.length === 0 ? [] : [...keys, 'unit_participants'];
}
