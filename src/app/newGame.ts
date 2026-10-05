/**
 * משחק חדש מאפס, בלי מערכת יצירת המשחקים (התוכנה המקומית).
 *
 * הקובץ נבנה כמו קובץ אופליין שהמערכת מייצאת למשחק חדש: אותם שדות ואותן
 * ברירות מחדל, כדי שכל המנוע — וגם העורך המקומי — יעבדו עליו בלי מקרים
 * מיוחדים. ההבדל היחיד הוא שאין לו עותק בשרת, ולכן הרישיון נקבע כאן.
 *
 * במשחק חייבת להיות לפחות שקופית אחת (gameFileSchema), ולכן הוא נפתח עם שאלת
 * טריוויה אחת לדוגמה שאפשר לערוך או למחוק אחרי שמוסיפים שאלות.
 */

import { parseGameFile, type GameFile } from '../engine/index.ts';
import { applyLicense, DEFAULT_LICENSE, type GameLicense } from './gameLicense.ts';
import { importedSlide } from './questionImport.ts';

export interface NewGameInput {
  name: string;
  license?: GameLicense;
  /** מזהה המשחק. מוזרק לבדיקות; ברירת המחדל היא UUID חדש. */
  id?: string;
  /** מוזרק לבדיקות; ברירת המחדל היא עכשיו. */
  now?: Date;
}

/** UUID, גם בסביבה בלי crypto.randomUUID (דפדפן ישן / http). */
function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/** הצבעים של משחק חדש במערכת: תיבה כהה וטקסט לבן, כמו שהם יוצאים למנוע. */
export const NEW_GAME_MAIN_COLOR = '#17064FCC';
export const NEW_GAME_SECONDARY_COLOR = '#FFFFFFEB';

export function newGameFile({ name, license = DEFAULT_LICENSE, id, now }: NewGameInput): GameFile {
  const media = { src: '' };
  const sound = { src: null };
  const raw = {
    name: name.trim(),
    id: id ?? newId(),
    createdAt: (now ?? new Date()).toISOString(),
    cloudinaryFolder: '',
    credit: null,
    users: '{}',
    assets: [],
    baseUrl: '',
    room: null,
    setting: {
      titleThroughoutGame: 'חויה בקליק',
      ansIsNumber: true,
      voterNameStyle: 'plain',
      visualTheme: 'classic',
      allowChangeVote: false,
      multiWinners: 5,
      showWinnersListAfter: null,
      winnersListCount: 5,
      mainColor: NEW_GAME_MAIN_COLOR,
      secondaryColor: NEW_GAME_SECONDARY_COLOR,
      gameMedia: media,
      logo: media,
      triviaMedia: media,
      winnersListMedia: media,
      winnersMedia: media,
      sound: {
        playersConnectingMediaSound: sound,
        showQuestionMediaSound: sound,
        winnersMediaSound: sound,
        winnersListMediaSound: sound,
        genericMediaSound: sound,
        timerMediaSound: sound,
        inShowAnsMediaSound: sound,
      },
      limit: { type: 'clickers' },
      // כמו בקובץ האופליין של המערכת: תמונה עוברת אחרי 10 שניות (כשמדליקים),
      // וסרטון מתנגן עד הסוף.
      autoTransition: {
        showAnswersAfterQuestion: false,
        startTimerAfterLastAnswer: false,
        showCorrectAnswerAfterTimer: false,
        nextSlide: { active: false, seconds: 6 },
        media: { image: { active: false, seconds: 10 }, video: { playToEnd: true } },
      },
      gameType: 'classic',
      gameTypeSettings: { snakesLadders: { progression: 'dice' } },
    },
    questions: [
      importedSlide(
        {
          row: 0,
          question: 'שאלה חדשה',
          type: 'trivia',
          answers: ['תשובה 1', 'תשובה 2', 'תשובה 3', 'תשובה 4'],
          correctIndex: 0,
        },
        1,
      ),
    ],
  };
  return applyLicense(parseGameFile(raw), license);
}
