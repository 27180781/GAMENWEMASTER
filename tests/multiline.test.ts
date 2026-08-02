/**
 * Enter בשאלה/בתשובה = שורה חדשה במסך.
 */

import { describe, expect, it } from 'vitest';
import { displayText, hasLineBreak } from '../src/render/multiline.ts';

describe('displayText', () => {
  it('תו שורה אמיתי נשמר — זה מה ש-Enter מייצר', () => {
    expect(displayText('שורה ראשונה\nשורה שנייה')).toBe('שורה ראשונה\nשורה שנייה');
  });

  it('שורה שנשמרה כשני התווים \\ ו-n הופכת לשורה אמיתית', () => {
    // ★ בלי זה המנחה רואה במסך את הטקסט "שורה1\nשורה2" כמו שהוא
    expect(displayText('שורה1\\nשורה2')).toBe('שורה1\nשורה2');
    expect(displayText('א\\\\nב')).toBe('א\nב'); // בריחה כפולה
  });

  it('CRLF של Windows מנורמל', () => {
    expect(displayText('א\r\nב\rג')).toBe('א\nב\nג');
  });

  it('רצף שורות ריקות מצטמצם לאחת — גובה המסך יקר', () => {
    expect(displayText('א\n\n\n\nב')).toBe('א\n\nב');
  });

  it('שורות ריקות ורווחים בקצוות נזרקים', () => {
    expect(displayText('\n\n  שאלה  \n\n')).toBe('  שאלה');
    expect(displayText('א   \nב')).toBe('א\nב'); // רווחים תלויים בסוף שורה
  });

  it('טקסט רגיל אינו משתנה', () => {
    expect(displayText('כמה זה 2+2?')).toBe('כמה זה 2+2?');
    expect(displayText('')).toBe('');
  });

  it('נתיב/כתובת עם n אחרי לוכסן הפוך אינו נפגע במקרה הרגיל', () => {
    // כתובות מדיה משתמשות בלוכסן קדימה, ולכן אינן מושפעות
    expect(displayText('https://x.co/name.png')).toBe('https://x.co/name.png');
  });

  it('hasLineBreak מזהה את שתי הצורות', () => {
    expect(hasLineBreak('א\nב')).toBe(true);
    expect(hasLineBreak('א\\nב')).toBe(true);
    expect(hasLineBreak('אב')).toBe(false);
  });
});
