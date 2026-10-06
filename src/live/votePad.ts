/**
 * שלט ההצבעה במסך הצפייה (‎?view=‎): מי שצופה מרחוק עונה מאותו מסך, בלי קוד
 * משחק ובלי טלפון נוסף.
 *
 * השלט שולח לשרת ההצבעות (Voting Bridge) בדיוק מה שקישור ההצבעה מהטלפון
 * (‎clicker.clicker.co.il‎) שולח: קוד החדר, השם (שהוא גם המזהה, ‎ApiPhone‎) ומספר
 * התשובה. לכן המסך הראשי מקבל אותו כמו כל מצביע מהטלפון — אותו מזהה, אותה
 * מגבלת רישיון ואותו לובי — ואין בו שום דבר חדש לשרת או למסך הראשי.
 *
 * כאן הכללים הטהורים: מתי ההצבעה פתוחה ואילו כפתורים יש לפי מה שהמסך הראשי
 * מציג (`padView`), איזה שם מותר, ומה נשלח.
 */

import { ANSWER_LETTERS, COIN_COLORS } from '../render/QuestionSlide.tsx';
import { NUM_COLORS } from '../render/GroupConnectScreen.tsx';
import type { LiveSnapshot } from './types.ts';

/** אורך שם מקסימלי — כמו בקישור ההצבעה מהטלפון. */
export const PLAYER_NAME_MAX = 20;

/** השם האחרון שהוזן, כדי שרענון או חזרה למשחק לא יבקשו אותו מחדש. */
export const PLAYER_NAME_STORAGE_KEY = 'trivia:viewer:name';

export interface PadKey {
  /** מה שנשלח לשרת: מזהה התשובה (‎answer.id‎), או מספר הקבוצה. */
  value: number;
  /** מה שכתוב על הכפתור — כמו על המטבע שליד התשובה במסך (אות או מספר). */
  label: string;
  bg: string;
  fg: string;
}

/**
 * ‏answers — שאלה פתוחה להצבעה; groups — מסך ההצטרפות לקבוצות; paused —
 * ההצבעה עצורה (מקש 6 או שכבה חוסמת: המסך הראשי לא קולט אז הקשות); closed —
 * אין עכשיו הצבעה.
 */
export type PadMode = 'answers' | 'groups' | 'paused' | 'closed';

export interface PadView {
  mode: PadMode;
  keys: PadKey[];
  /**
   * החלון שההקשות שייכות אליו: מתחלף בכל שאלה ובכל מסך קבוצות, ואיתו
   * מתאפסת הבחירה שמוצגת לצופה. ריק כשאין חלון.
   */
  windowKey: string;
  /** אפשר לשנות תשובה בחלון הזה (אחרת המסך הראשי סופר רק את ההקשה הראשונה). */
  changeable: boolean;
}

const CLOSED: PadView = { mode: 'closed', keys: [], windowKey: '', changeable: true };

/**
 * מה השלט מציג עכשיו — לפי אותם תנאים שבהם המסך הראשי פותח את חלון
 * ההצבעה (GameHost: ‏‎votingActive || connectCategory !== null‎).
 */
export function padView(snap: LiveSnapshot): PadView {
  const connect = snap.overlays.connect;
  if (connect !== null) {
    return {
      mode: 'groups',
      windowKey: `groups:${connect.groups.map((g) => g.id).join(',')}`,
      changeable: true, // "הקשה אחרונה קובעת"
      keys: connect.groups.map((_, i) => {
        const color = NUM_COLORS[i % NUM_COLORS.length]!;
        return { value: i + 1, label: String(i + 1), bg: color.bg, fg: color.fg };
      }),
    };
  }
  if (snap.stage !== 'playing' || snap.state.phase !== 'voting') return CLOSED;
  const slide = snap.game.slides[String(snap.state.currentSlideIndex)];
  const answers = slide?.question.answers ?? [];
  if (slide === undefined || answers.length === 0) return CLOSED;
  const ansIsNumber = snap.game.setting.ansIsNumber;
  return {
    mode: snap.timer?.paused === true ? 'paused' : 'answers',
    windowKey: `slide:${snap.state.currentSlideId}`,
    changeable: snap.game.setting.allowChangeVote || slide.setting.allowChangeVote,
    // אותו צבע ואותה אות כמו המטבע שליד כל תשובה (QuestionSlide / BetSlide).
    keys: answers.map((answer, index) => {
      const coin = COIN_COLORS[index] ?? COIN_COLORS[0]!;
      return {
        value: answer.id,
        label: ansIsNumber ? String(answer.id) : (ANSWER_LETTERS[index] ?? String(answer.id)),
        bg: coin.bg,
        fg: coin.fg,
      };
    }),
  };
}

/** קוד החדר שאליו מצביעים — מה שהמסך הראשי מציג בבאנר ההצטרפות. */
export function padRoom(snap: LiveSnapshot): string | null {
  const code = snap.join.code.trim();
  return code === '' ? null : code;
}

/** רווחים מיותרים החוצה, ולא יותר מ-PLAYER_NAME_MAX תווים. */
export function cleanPlayerName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, PLAYER_NAME_MAX).trim();
}

/**
 * למה השם לא מתאים, או null. השם הוא גם המזהה של המשתתף במשחק, ולכן חייבת
 * בו אות: שם של ספרות בלבד היה יכול להיות מספר טלפון של משתתף רשום או של
 * שלט המנחה — ולהצביע בשמו או לשלוט במשחק.
 */
export function playerNameProblem(name: string): string | null {
  if (name === '') return 'כתבו את השם שלכם';
  if (!/\p{L}/u.test(name)) return 'השם צריך לכלול לפחות אות אחת';
  return null;
}

/** הצטרפות: ‏‎/game/join‎ — המשתתף מופיע בלובי של המסך הראשי. */
export function joinFields(room: string, name: string): Record<string, string> {
  return { gameId: room, ApiPhone: name };
}

/** הקשה: ‏‎/game/voting‎ — אותם שדות כמו בקישור ההצבעה מהטלפון. */
export function voteFields(
  room: string,
  name: string,
  value: number,
  now: number,
): Record<string, string> {
  return {
    gameId: room,
    vote: String(value),
    playerName: name,
    ApiTime: String(now),
    ApiPhone: name,
  };
}

export type VotePath = '/game/join' | '/game/voting';

/** שליחה לשרת ההצבעות. true = השרת קיבל (הוא עונה "OK"). */
export async function postToVoteServer(
  serverUrl: string,
  path: VotePath,
  fields: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${serverUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function readSavedPlayerName(): string {
  try {
    return cleanPlayerName(window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? '');
  } catch {
    return '';
  }
}

export function savePlayerName(name: string): void {
  try {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  } catch {
    /* דפדפן בלי אחסון — פשוט לא נזכור את השם */
  }
}
