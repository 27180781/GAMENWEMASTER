/**
 * הרכבת מספרים מקטעי הבנק (ENGINE-narration.md 2.2). כל הדוגמאות מהמסמך
 * נבדקות כאן מילה במילה, כי מנוע שמרכיב מספר לא נכון נשמע שבור בכל שאלה.
 */

import { describe, expect, it } from 'vitest';
import {
  numberClipKeys,
  participantsClipKeys,
  pointsClipKeys,
} from '../src/app/narration/hebrewNumber.ts';

describe('numberClipKeys — הדוגמאות שבחוזה', () => {
  it('★ 21 → עשרים ואחת', () => {
    expect(numberClipKeys(21, 'f')).toEqual(['tens_20', 'num_f_v_1']);
  });

  it('★ 120 → מאה ועשרים', () => {
    expect(numberClipKeys(120, 'f')).toEqual(['hundreds_100', 'tens_v_20']);
  });

  it('★ 123 → מאה עשרים ושלוש (ו׳ רק על החלק האחרון)', () => {
    expect(numberClipKeys(123, 'f')).toEqual(['hundreds_100', 'tens_20', 'num_f_v_3']);
  });

  it('★ 1,250 → אלף מאתיים וחמישים', () => {
    expect(numberClipKeys(1250, 'f')).toEqual(['thousands_1000', 'hundreds_200', 'tens_v_50']);
  });

  it('★ 12,000 → שנים עשר אלף (בלי ו׳)', () => {
    expect(numberClipKeys(12000, 'f')).toEqual(['num_m_12', 'thousands_word']);
  });

  it('★ 10,000 → עשרת אלפים (קטע אחד)', () => {
    expect(numberClipKeys(10000, 'f')).toEqual(['thousands_10000']);
  });

  it('★ 0 → אפס, גם בזכר', () => {
    expect(numberClipKeys(0, 'f')).toEqual(['num_f_0']);
    expect(numberClipKeys(0, 'm')).toEqual(['num_f_0']);
  });
});

describe('numberClipKeys — חלקים ומגדר', () => {
  it('1–19 הן יחידה אחת, בכל מגדר', () => {
    expect(numberClipKeys(7, 'f')).toEqual(['num_f_7']);
    expect(numberClipKeys(7, 'm')).toEqual(['num_m_7']);
    expect(numberClipKeys(19, 'f')).toEqual(['num_f_19']);
    expect(numberClipKeys(19, 'm')).toEqual(['num_m_19']);
  });

  it('עשרות עגולות — קטע אחד בלי ו׳', () => {
    expect(numberClipKeys(20, 'f')).toEqual(['tens_20']);
    expect(numberClipKeys(90, 'm')).toEqual(['tens_90']);
  });

  it('מאות עגולות, ומאה ואחת', () => {
    expect(numberClipKeys(100, 'f')).toEqual(['hundreds_100']);
    expect(numberClipKeys(101, 'f')).toEqual(['hundreds_100', 'num_f_v_1']);
    expect(numberClipKeys(900, 'm')).toEqual(['hundreds_900']);
  });

  it('אלפים עגולים — קטע אחד; אלף ומאתיים — ו׳ על המאות', () => {
    expect(numberClipKeys(1000, 'f')).toEqual(['thousands_1000']);
    expect(numberClipKeys(9000, 'f')).toEqual(['thousands_9000']);
    expect(numberClipKeys(1200, 'f')).toEqual(['thousands_1000', 'hundreds_v_200']);
  });

  it('11,000–19,000 — מספר בזכר + "אלף"', () => {
    expect(numberClipKeys(11000, 'f')).toEqual(['num_m_11', 'thousands_word']);
    expect(numberClipKeys(19000, 'm')).toEqual(['num_m_19', 'thousands_word']);
  });

  it('★ 21,000 — ו׳ בתוך ספירת האלפים, ולא אחריה', () => {
    expect(numberClipKeys(21000, 'f')).toEqual(['tens_20', 'num_m_v_1', 'thousands_word']);
    expect(numberClipKeys(20000, 'f')).toEqual(['tens_20', 'thousands_word']);
  });

  it('מספר מלא: 21,345', () => {
    expect(numberClipKeys(21345, 'f')).toEqual([
      'tens_20',
      'num_m_v_1',
      'thousands_word',
      'hundreds_300',
      'tens_40',
      'num_f_v_5',
    ]);
  });

  it('10,001 — עשרת אלפים ואחת', () => {
    expect(numberClipKeys(10001, 'f')).toEqual(['thousands_10000', 'num_f_v_1']);
  });

  it('99,999 — הגבול העליון עדיין מורכב', () => {
    expect(numberClipKeys(99999, 'f')).toEqual([
      'tens_90',
      'num_m_v_9',
      'thousands_word',
      'hundreds_900',
      'tens_90',
      'num_f_v_9',
    ]);
  });
});

describe('numberClipKeys — מקרי קצה', () => {
  it('שלילי → הערך המוחלט', () => {
    expect(numberClipKeys(-21, 'f')).toEqual(['tens_20', 'num_f_v_1']);
  });

  it('שבר → מעוגל', () => {
    expect(numberClipKeys(2.4, 'f')).toEqual(['num_f_2']);
    expect(numberClipKeys(2.6, 'f')).toEqual(['num_f_3']);
  });

  it('מעל 99,999 → אין מה לומר (רשימה ריקה)', () => {
    expect(numberClipKeys(100000, 'f')).toEqual([]);
    expect(numberClipKeys(1234567, 'm')).toEqual([]);
  });

  it('לא-מספר → רשימה ריקה, בלי לזרוק', () => {
    expect(numberClipKeys(Number.NaN, 'f')).toEqual([]);
    expect(numberClipKeys(Number.POSITIVE_INFINITY, 'f')).toEqual([]);
  });
});

describe('pointsClipKeys — ניקוד', () => {
  it('★ 1 → "נקודה אחת"; 2 → "שתי נקודות"', () => {
    expect(pointsClipKeys(1)).toEqual(['unit_point_one']);
    expect(pointsClipKeys(2)).toEqual(['num_f_2_construct', 'unit_points']);
  });

  it('שאר המספרים — נקבה + "נקודות"', () => {
    expect(pointsClipKeys(3)).toEqual(['num_f_3', 'unit_points']);
    expect(pointsClipKeys(21)).toEqual(['tens_20', 'num_f_v_1', 'unit_points']);
    expect(pointsClipKeys(0)).toEqual(['num_f_0', 'unit_points']);
  });

  it('מספר שאי אפשר להרכיב — שקט מוחלט (בלי "נקודות" יתומות)', () => {
    expect(pointsClipKeys(150000)).toEqual([]);
  });
});

describe('participantsClipKeys — משתתפים', () => {
  it('★ 1 → "משתתף אחד"; 2 → "שני משתתפים"', () => {
    expect(participantsClipKeys(1)).toEqual(['unit_participant_one']);
    expect(participantsClipKeys(2)).toEqual(['num_m_2_construct', 'unit_participants']);
  });

  it('שאר המספרים — זכר + "משתתפים"', () => {
    expect(participantsClipKeys(3)).toEqual(['num_m_3', 'unit_participants']);
    expect(participantsClipKeys(23)).toEqual(['tens_20', 'num_m_v_3', 'unit_participants']);
  });
});
