import { describe, it, expect } from 'vitest';
import { hostKeyHints, type HostHintInput } from '../src/app/hostHints.ts';

const base: HostHintInput = {
  phase: 'showing',
  activeMedia: null,
  slideType: 'trivia',
  votable: true,
  totalAnswers: 4,
  questionShown: false,
  answersShown: 0,
  revealCorrect: false,
  hasNextSlide: true,
};
const space = (a: Partial<HostHintInput>) => hostKeyHints({ ...base, ...a })[0]!.label;
const keys = (a: Partial<HostHintInput>) => hostKeyHints({ ...base, ...a }).map((h) => h.key);

describe('hostKeyHints — פעולת הרווח לפי שלב', () => {
  it('שאלה טרם הוצגה → הצגת השאלה', () => {
    expect(space({ questionShown: false })).toBe('הצגת השאלה');
  });
  it('שאלה הוצגה, לא כל התשובות → הצגת תשובה', () => {
    expect(space({ questionShown: true, answersShown: 1 })).toBe('הצגת תשובה');
  });
  it('כל התשובות חשופות → פתיחת הצבעה + טיימר', () => {
    expect(space({ questionShown: true, answersShown: 4 })).toBe('פתיחת ההצבעה + טיימר');
  });
  it('הצבעה → סיום ההצבעה', () => {
    expect(space({ phase: 'voting' })).toBe('סיום ההצבעה');
  });
  it('תוצאות trivia בלי חשיפה → חשיפת התשובה הנכונה', () => {
    expect(space({ phase: 'results', revealCorrect: false, slideType: 'trivia' })).toBe(
      'חשיפת התשובה הנכונה',
    );
  });
  it('תוצאות סקר/תמונות בלי חשיפה → חשיפת התוצאות', () => {
    expect(space({ phase: 'results', revealCorrect: false, slideType: 'ans_images' })).toBe(
      'חשיפת התוצאות',
    );
  });
  it('אחרי חשיפה → השקופית הבאה', () => {
    expect(space({ phase: 'results', revealCorrect: true })).toBe('השקופית הבאה');
  });
  it('מדיה חוסמת מוצגת → המשך (סיום המדיה)', () => {
    expect(space({ activeMedia: 'open' })).toBe('המשך (סיום המדיה)');
  });
  it('שקופית מדיה/טקסט → השקופית הבאה', () => {
    expect(space({ phase: 'showing', votable: false, slideType: 'subject' })).toBe('השקופית הבאה');
  });
  it('שקופית אחרונה → סיום המשחק', () => {
    expect(space({ phase: 'results', revealCorrect: true, hasNextSlide: false })).toBe('סיום המשחק');
  });
});

describe('hostKeyHints — מקשי מספרים לפי הקשר', () => {
  it('בזמן הצבעה מציג 4/5 ו-6', () => {
    expect(keys({ phase: 'voting' })).toEqual(['רווח', '4/5', '6', '1', '2', '3', 'N']);
  });
  it('מחוץ להצבעה — בלי 4/5 ו-6', () => {
    expect(keys({ phase: 'showing' })).toEqual(['רווח', '1', '2', '3', 'N']);
  });
  it('בשלב חשיפת התשובה (results) מציג את מקש 5 — פירוט הצבעות', () => {
    expect(keys({ phase: 'results', votable: true })).toEqual(['רווח', '5', '1', '2', '3', 'N']);
    // שקופית לא-מצביעה — בלי 5
    expect(keys({ phase: 'results', votable: false })).toEqual(['רווח', '1', '2', '3', 'N']);
  });
});
