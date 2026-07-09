import { describe, expect, it } from 'vitest';
import { STAGE_HEIGHT, STAGE_WIDTH, stageScale, stageTransform } from '../src/render/Stage.tsx';

describe('stageScale — התאמת במת 16:9 לכל מסך בלי גלילה', () => {
  it('הבמה הלוגית היא 16:9', () => {
    expect(STAGE_WIDTH / STAGE_HEIGHT).toBeCloseTo(16 / 9, 10);
  });

  it('מסך 16:9 מדויק — הבמה ממלאת אותו בדיוק', () => {
    expect(stageScale(1920, 1080)).toBe(1);
    expect(stageScale(3840, 2160)).toBe(2);
    expect(stageScale(1280, 720)).toBeCloseTo(2 / 3, 10);
  });

  it('מסך רחב מ-16:9 — הגובה קובע (פסים בצדדים), והבמה לא גולשת', () => {
    const scale = stageScale(2560, 1080);
    expect(scale).toBe(1); // לפי הגובה
    expect(STAGE_WIDTH * scale).toBeLessThanOrEqual(2560);
  });

  it('מסך צר/גבוה — הרוחב קובע (פסים למעלה ולמטה), והבמה לא גולשת', () => {
    const scale = stageScale(1080, 1920);
    expect(scale).toBeCloseTo(1080 / 1920, 10);
    expect(STAGE_HEIGHT * scale).toBeLessThanOrEqual(1920);
  });

  it('ערכי קצה לא שוברים', () => {
    expect(stageScale(0, 0)).toBe(1);
    expect(stageScale(-5, 100)).toBe(1);
  });
});

describe('stageTransform — מרכוז בפיקסלים (חסין RTL וסדר translate/scale)', () => {
  it('מסך 16:9 מדויק — בלי היסט', () => {
    expect(stageTransform(1920, 1080)).toBe('translate(0px, 0px) scale(1)');
  });

  it('ultrawide — פסים שווים בצדדים, אפס היסט אנכי', () => {
    // scale=1 לפי גובה; רוחב הבמה 1920 → היסט אופקי (2560-1920)/2 = 320
    expect(stageTransform(2560, 1080)).toBe('translate(320px, 0px) scale(1)');
  });

  it('מסך גבוה — פסים שווים למעלה ולמטה, הבמה בתוך המסך', () => {
    const scale = 900 / 1920;
    const offsetY = (1400 - 1080 * scale) / 2;
    expect(stageTransform(900, 1400)).toBe(`translate(0px, ${offsetY}px) scale(${scale})`);
    expect(1080 * scale + offsetY).toBeLessThanOrEqual(1400);
  });
});
