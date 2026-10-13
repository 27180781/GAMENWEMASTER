/**
 * מסך השאלה בגובה שיש לו (נמצא בבדיקת משוב של לקוח, «קליקרים מי בראש», 2026-10).
 *
 * עד 2026-10 לכל חלק במסך השאלה היה תקציב גובה קבוע: טקסט השאלה עד 240px
 * (תמונה שהיא השאלה עד 320px), וכל תשובת טקסט עד ‎536px / מספר השורות. יחד
 * התקציבים גבוהים מהמסך: שאלה ארוכה עם 7–8 תשובות ארוכות (וגם 5–6) דחפה את
 * שורת התשובות האחרונה מתחת לפס «צדקו / טעו» ואל מחוץ למסך, ופס הקבוצות,
 * שמצר את התשובות, החמיר את זה. עכשיו הגובה נמדד ומתחלק:
 *   • השאלה — עד התקרה הקבועה, אבל לא יותר ממה שמשאיר לכל שורת תשובות גובה
 *     של כרטיס מינימלי.
 *   • התשובות — מה שהשאלה לא לקחה, שווה בשווה בין השורות, ולא יותר מהתקציב
 *     הקבוע. מסך שנכנס עד היום לא משתנה.
 * המקום של הספירה לאחור שמור גם לפני ההצבעה ואחריה, כדי שהגדלים לא יקפצו כשהיא
 * מופיעה ונעלמת.
 *
 * החשבון טהור ונבדק ביחידה; fitQuestionScreen מודד את המסך ומחיל.
 */

/**
 * כמה מקום הספירה לאחור תופסת ב-q-main: ‎.q-countdown (עיגול 112 שנכנס 28
 * לתוך פס של 44, ועוד ‎-4 מתחת) והרווח שאחריה (22). קבוע ולא נמדד, כי לפני
 * ההצבעה ואחריה היא לא קיימת, והגדלים צריכים להיות זהים בכל השלבים. ערכות
 * הנושא לא משנות את הגאומטריה.
 */
export const COUNTDOWN_SPACE = 146;

/**
 * מ-4 שורות תשובות (7–8 תשובות) הכרטיסים צפופים (‎.q-answers--dense): מטבע
 * קטן יותר, פחות ריפוד ורווח. בגודל הרגיל ארבע שורות תופסות 476px, ובזמן
 * ההצבעה נשארו לשאלה 88px בלבד (44 עם באנר ההצטרפות).
 */
export const DENSE_ROWS = 4;

/**
 * כרטיס תשובה מינימלי (המטבע ועוד הריפוד והמסגרת — גבוה מ-min-height) והרווח
 * בין השורות, כשאין גריד למדוד (עוגת הסקר בחשיפה). לשמור תואם ל-styles.css.
 */
const CARD_MIN = { regular: 104, dense: 80 };
const ROW_GAP = { regular: 20, dense: 12 };

/** הגדלים הקטנים ביותר — כמו FitText עד היום (שאלה 13, תשובה 12). */
const QUESTION_MIN_FONT = 13;
const ANSWER_MIN_FONT = 12;

/** תקרות שלא יורדים מתחתן גם במסך צפוף מאוד: שורה אחת של שאלה / של תשובה. */
const QUESTION_FLOOR = 48;
const ANSWER_FLOOR = 30;

export interface QuestionSpace {
  /** הגובה שבין הכותרת לפס התחתון, כשהפס בגובה המינימלי שלו. */
  space: number;
  /** הספירה לאחור והרווח שאחריה (COUNTDOWN_SPACE). */
  countdown: number;
  /** הרווח בין השאלה לתשובות (gap של q-main). */
  gap: number;
  /** הריפוד והמסגרת של בועת השאלה, למעלה ולמטה יחד. */
  questionChrome: number;
  /** הגובה המינימלי של התשובות (answersMinHeight); 0 = תשובות תמונה, שמתכווצות בעצמן. */
  answersMin: number;
}

/** הגובה המינימלי של תשובות הטקסט: כל שורה בגובה כרטיס מינימלי. */
export function answersMinHeight(rows: number, cardMin: number, rowGap: number): number {
  return rows <= 0 ? 0 : rows * cardMin + (rows - 1) * rowGap;
}

/**
 * תקרת הגובה של תוכן בועת השאלה (הטקסט, או התמונה שהיא השאלה): התקרה הקבועה
 * (cssMax), או פחות — כשהתשובות צריכות את המקום.
 */
export function questionContentMax(s: QuestionSpace, cssMax: number, floor = QUESTION_FLOOR): number {
  const room = Math.floor(s.space - s.countdown - s.questionChrome - s.gap - s.answersMin);
  return Math.min(cssMax, Math.max(floor, room));
}

/**
 * תקרת הגובה של הטקסט בכל תשובה: חלק שווה ממה שנשאר לתשובות, בלי הריפוד
 * והמסגרת של הכרטיס, ולא יותר מהתקציב הקבוע (cssMax).
 */
export function answerTextMax(o: {
  /** הגובה שנשאר לתשובות אחרי הספירה לאחור, השאלה והרווח. */
  answersSpace: number;
  rows: number;
  rowGap: number;
  /** הריפוד והמסגרת של כרטיס, למעלה ולמטה יחד. */
  cardChrome: number;
  cssMax: number;
  floor?: number;
}): number {
  const rows = Math.max(1, o.rows);
  const row = (o.answersSpace - (rows - 1) * o.rowGap) / rows;
  return Math.min(o.cssMax, Math.max(o.floor ?? ANSWER_FLOOR, Math.floor(row - o.cardChrome)));
}

/** הגודל הגדול ביותר בין lo ל-hi (בצעדים של חצי פיקסל) שבו fits מצליח; lo כשאף אחד לא — כמו FitText. */
export function largestFitting(lo: number, hi: number, fits: (size: number) => boolean): number {
  let best = lo;
  let low = lo;
  let high = hi;
  while (low <= high) {
    const mid = (low + high) / 2;
    if (fits(mid)) {
      best = mid;
      low = mid + 0.5;
    } else {
      high = mid - 0.5;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// המדידה במסך
// ---------------------------------------------------------------------------

export interface QuestionFitElements {
  /** ‎.q-content — הכותרת, האזור הראשי והפס התחתון. */
  content: HTMLElement;
  header: HTMLElement;
  main: HTMLElement;
  footer: HTMLElement;
  /** בועת השאלה (‎.q-question). */
  question: HTMLElement;
  /** גריד תשובות הטקסט; null = אין (תשובות תמונה, או עוגת הסקר בחשיפה). */
  answers: HTMLElement | null;
  /** כמה שורות תשובות טקסט יש בשקופית, גם כשהעוגה מחליפה אותן; 0 = תשובות תמונה. */
  rows: number;
}

const px = (value: string): number => parseFloat(value) || 0;

const chromeOf = (cs: CSSStyleDeclaration): number =>
  px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);

/** הגובה הנמוך ביותר של כרטיס: min-height, או המטבע (והמונה החי) ועוד הריפוד והמסגרת — הגבוה מהם. */
function cardMinHeight(card: HTMLElement): number {
  const cs = getComputedStyle(card);
  let tallest = 0;
  for (const child of card.children) {
    if (child instanceof HTMLElement && !child.classList.contains('q-card-text')) {
      tallest = Math.max(tallest, child.offsetHeight);
    }
  }
  return Math.max(px(cs.minHeight), tallest + chromeOf(cs));
}

/** האם התוכן נכנס בקופסה (overflow: hidden) — כמו FitText ובדיקת הצילומים. */
const fitsBox = (el: HTMLElement): boolean =>
  el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;

/** מקטין את הפונט של el עד שהתוכן נכנס (לא מתחת ל-min). מחזיר את הגודל שנקבע. */
function shrinkToFit(el: HTMLElement, min: number): number {
  const css = px(getComputedStyle(el).fontSize) || 20;
  if (fitsBox(el)) return css;
  const size = largestFitting(Math.min(min, css), css, (s) => {
    el.style.fontSize = `${s}px`;
    return fitsBox(el);
  });
  el.style.fontSize = `${size}px`;
  return size;
}

/**
 * מודד את מסך השאלה ומחיל: תקרת גובה לטקסט השאלה (או לתמונה שהיא השאלה),
 * הקטנה שלו עד שהוא נכנס, תקרת גובה לטקסט התשובות, והקטנה של כל תשובה עד שהיא
 * נכנסת. כל ריצה
 * מתחילה מגדלי ה-CSS, ולכן התוצאה תלויה רק בתוכן ובמקום — ריצה חוזרת לא משנה
 * כלום.
 */
export function fitQuestionScreen(d: QuestionFitElements): void {
  const text = d.question.querySelector<HTMLElement>('.q-question-text');
  const image = d.question.querySelector<HTMLImageElement>('.q-question-main-image');
  const cards = d.answers === null ? [] : [...d.answers.querySelectorAll<HTMLElement>('.q-card-text')];
  for (const el of [text, image, ...cards]) {
    if (el === null) continue;
    el.style.fontSize = '';
    el.style.maxHeight = '';
  }

  const space = d.content.clientHeight - d.header.offsetHeight - px(getComputedStyle(d.footer).minHeight);
  if (space <= 0) return; // מוסתר — ResizeObserver יריץ שוב כשיוצג

  const card = cards[0]?.closest<HTMLElement>('.q-card') ?? null;
  const density = d.rows >= DENSE_ROWS ? 'dense' : 'regular';
  const rowGap = d.answers === null ? ROW_GAP[density] : px(getComputedStyle(d.answers).rowGap);
  const questionChrome = chromeOf(getComputedStyle(d.question));
  const s: QuestionSpace = {
    space,
    countdown: COUNTDOWN_SPACE,
    gap: px(getComputedStyle(d.main).rowGap),
    questionChrome,
    answersMin: answersMinHeight(d.rows, card === null ? CARD_MIN[density] : cardMinHeight(card), rowGap),
  };

  if (text !== null) {
    const cssMax = px(getComputedStyle(text).maxHeight);
    const max = questionContentMax(s, cssMax);
    if (max < cssMax) text.style.maxHeight = `${max}px`;
    shrinkToFit(text, QUESTION_MIN_FONT);
  }
  // תמונה שעוד לא נטענה נספרת בגובה המלא שמותר לה — שהתשובות לא יגלשו כשהיא
  // תיטען (QuestionSlide מריץ שוב בטעינה, ואז הן מקבלות את מה שלא נוצל).
  let questionHeight = d.question.offsetHeight;
  if (image !== null) {
    const cssMax = px(getComputedStyle(image).maxHeight);
    const max = questionContentMax(s, cssMax);
    if (max < cssMax) image.style.maxHeight = `${max}px`;
    if (!(image.complete && image.naturalHeight > 0)) questionHeight = Math.max(questionHeight, questionChrome + max);
  }

  if (card === null) return;
  const first = cards[0]!;
  const cssTextMax = px(getComputedStyle(first).maxHeight);
  const textMax = answerTextMax({
    answersSpace: space - s.countdown - questionHeight - s.gap,
    rows: d.rows,
    rowGap,
    cardChrome: chromeOf(getComputedStyle(card)),
    cssMax: cssTextMax,
  });
  if (textMax < cssTextMax) for (const el of cards) el.style.maxHeight = `${textMax}px`;

  for (const el of cards) shrinkToFit(el, ANSWER_MIN_FONT);
}
