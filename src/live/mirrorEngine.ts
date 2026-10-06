/**
 * "מנוע" לקריאה בלבד מתוך מצב המסך שהתקבל — כדי שמסך הצפייה ירנדר את אותם
 * רכיבים בדיוק (SlideView, מסכי המנצחים והניקוד) בלי להריץ את המשחק עצמו.
 *
 * רק השקופית הנוכחית (ושקופית ההימור שהיא מכריעה) מגיעות מהמסך הראשי; שאר
 * המקומות ממולאים בשקופיות ריקות, כדי שמונה השקופיות וחיפוש ההימור שלפני
 * השאלה (betSlideFor) יתנהגו כמו במסך הראשי.
 */

import type { GameFile, GameState, Slide } from '../engine/index.ts';
import type { EngineView } from '../render/engineView.ts';
import type { LiveSnapshot } from './types.ts';

/** שקופית ריקה שאינה הימור ואינה מנוקדת — במקום שקופית שלא נשלחה. */
function placeholderSlide(template: Slide, id: number): Slide {
  const slide: Record<string, unknown> = {
    ...template,
    id,
    type: 'media',
    question: { ...template.question, que: '', src: '', answers: [] },
    openMedia: { src: '' },
    endMedia: { src: '' },
    backgroundMedia: { src: '' },
  };
  delete slide.function;
  delete slide.bet;
  delete slide.narration;
  return slide as unknown as Slide;
}

/** זמן התגובה הממוצע — כמו GameEngine.averageResponseMs. */
function averageResponseMs(state: GameState, voterId: string): number {
  const t = state.answerTimes[voterId];
  return t !== undefined && t.count > 0 ? t.totalMs / t.count : Number.POSITIVE_INFINITY;
}

export function mirrorEngine(snapshot: LiveSnapshot): EngineView {
  const state = snapshot.state as GameState;
  const sent = snapshot.game.slides;
  const current = sent[String(state.currentSlideIndex)];
  const template = current ?? Object.values(sent)[0];
  const count = Math.max(snapshot.game.slideCount, state.currentSlideIndex + 1, 1);
  const questions: Slide[] = [];
  for (let i = 0; i < count; i++) {
    const real = sent[String(i)];
    if (real !== undefined) questions.push(real);
    else if (template !== undefined) questions.push(placeholderSlide(template, -(i + 1)));
  }
  const game = {
    name: snapshot.game.name,
    id: '',
    questions,
    setting: snapshot.game.setting,
    assets: [],
    createdAt: '',
    cloudinaryFolder: '',
    credit: null,
    users: '{}',
    room: null,
    baseUrl: '',
    cloudinaryAbsolutePathImage: '',
    cloudinaryAbsolutePathVideo: '',
  } as GameFile;

  return {
    getState: () => state,
    getGame: () => game,
    getCurrentSlide: () => {
      const slide = questions[state.currentSlideIndex];
      if (slide === undefined) throw new Error('השקופית הנוכחית לא התקבלה');
      return slide;
    },
    // אותו מיון כמו GameEngine.getWinners: ניקוד, זמן תגובה ממוצע, מזהה.
    // הכינויים שומרים על סדר המזהים (aliases.ts), כך ששובר השוויון זהה.
    getWinners: (limit: number = game.setting.multiWinners) =>
      Object.entries(state.scores)
        .map(([voterId, score]) => ({ voterId, score }))
        .sort(
          (a, b) =>
            b.score - a.score ||
            averageResponseMs(state, a.voterId) - averageResponseMs(state, b.voterId) ||
            a.voterId.localeCompare(b.voterId),
        )
        .slice(0, Math.max(0, limit)),
  };
}
