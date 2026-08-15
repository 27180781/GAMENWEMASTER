/**
 * משחק הדוגמה שמופיע בכל פרקי המדריך. נבנה כאן ולא נשלף מהדיסק, כדי
 * שההקלטות יהיו זהות בכל הרצה ולא יהיו תלויות בקובץ חיצוני.
 */

import { createRequire } from 'node:module';
import { ROOT } from './harness.mjs';

const require = createRequire(`${ROOT}/package.json`);
const JSZip = require('jszip');

const SLIDE_SETTING = {
  allowChangeVote: false, slideStartVoting: true, playAfterClicking: false, exitGame: false,
  correctlyAnsweredBefore: false, firstClicker: false, answerIsSequenceClicks: false,
  fullscreen: false, scoringReduction: { active: false, seconds: '', score: '' },
  slidBackgroundMedia: { src: '' }, automaticSkip: { active: false, seconds: '' }, showInLoop: false,
};

const SOUND = {
  playersConnectingMediaSound: { src: null }, showQuestionMediaSound: { src: null },
  winnersMediaSound: { src: null }, winnersListMediaSound: { src: null },
  genericMediaSound: { src: null }, timerMediaSound: { src: null }, inShowAnsMediaSound: { src: null },
};

const slide = (id, type, que, answers) => ({
  id, type,
  question: { que, scoreForQue: 10, timeForQue: 20, src: '', answers },
  openMedia: { src: '' }, endMedia: { src: '' }, backgroundMedia: { src: '' },
  setting: structuredClone(SLIDE_SETTING),
});

const ans = (list, correctIndex) =>
  list.map((text, i) => ({ ans: text, correct: i === correctIndex, id: i + 1 }));

export const DEMO_GAME = {
  id: 'guide-demo',
  name: 'ערב טריוויה לדוגמה',
  users: '{}',
  setting: {
    titleThroughoutGame: 'ערב טריוויה',
    ansIsNumber: true, multiWinners: 3, showWinnersListAfter: null, winnersListCount: 5,
    gameMedia: { src: '' }, logo: { src: '' }, triviaMedia: { src: '' },
    winnersMedia: { src: '' }, winnersListMedia: { src: '' },
    mainColor: '#8B2FC9', secondaryColor: '#FFD23F', sound: SOUND,
    limit: { type: 'clickers' },
  },
  questions: [
    slide(1, 'trivia', 'מהי בירת ישראל?', ans(['ירושלים', 'תל אביב', 'חיפה', 'אילת'], 0)),
    slide(2, 'trivia', 'כמה שחקנים יש בקבוצת כדורסל על המגרש?', ans(['5', '6', '7', '11'], 0)),
    slide(3, 'survey', 'איזה קינוח אתם מעדיפים?', ans(['גלידה', 'עוגת שוקולד', 'פירות'], -1)),
    slide(4, 'subject', 'הפסקה קצרה ☕', ans(['א', 'ב'], 0)),
    slide(5, 'trivia', 'באיזו שנה קמה מדינת ישראל?', ans(['1948', '1945', '1950', '1967'], 0)),
  ],
};

/** קובץ המשחק כ-ZIP מקודד base64 — כמו שהתוכנה טוענת מהדיסק. */
export async function demoZipB64(game = DEMO_GAME) {
  const zip = new JSZip();
  zip.file('data.json', JSON.stringify(game));
  return (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
}
