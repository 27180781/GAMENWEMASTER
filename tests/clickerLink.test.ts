/**
 * איזו חוליה בשרשרת הקליקרים שבורה. המקרה שהוליד את זה: חלון הקליטה מציג
 * "מחובר" (הדונגל), המשחק מתריע (החיבור אלינו) — והמנחה לא מבין למה.
 */

import { describe, expect, it } from 'vitest';
import { clickerLinkMessage, clickerLinkOk } from '../src/app/clickerLink.ts';

describe('clickerLinkMessage', () => {
  it('שרשרת שלמה — אין אזהרה', () => {
    expect(clickerLinkMessage(true, 'connected')).toBeNull();
    expect(clickerLinkOk(true, 'connected')).toBe(true);
  });

  it('★ תוכנת הקליטה פועלת אך לא מחוברת אלינו — ההודעה אומרת בדיוק את זה', () => {
    const msg = clickerLinkMessage(false, 'connected');
    expect(msg).not.toBeNull();
    // ★ המקרה המבלבל: הדונגל מחובר, ולכן חלון הקליטה נראה תקין
    expect(msg).toContain('אינה מחוברת לתוכנת המשחק');
    expect(msg).toContain('Connect');
  });

  it('מחוברים אלינו, אבל הדונגל לא — הפוך, וההודעה הפוכה', () => {
    const msg = clickerLinkMessage(true, 'disconnected');
    expect(msg).toContain('הדונגל אינו מחובר');
    expect(msg).not.toContain('אינה מחוברת לתוכנת המשחק');
  });

  it('הדונגל בתהליך חיבור — הודעה מרגיעה, לא שגיאה', () => {
    expect(clickerLinkMessage(true, 'connecting')).toContain('מתחבר');
  });

  it('מחוברים אלינו אך אין עדיין דיווח על הדונגל', () => {
    expect(clickerLinkMessage(true, null)).toContain('טרם דיווחה');
  });

  it('עוד לא שמענו כלום — ממתינים לתוכנת הקליטה', () => {
    const msg = clickerLinkMessage(null, null);
    expect(msg).toContain('ממתין');
    expect(msg).toContain('8090');
  });

  it('גרסת ריסיבר ישנה שלא מדווחת חיבור סוקט — הדונגל לבדו מספיק', () => {
    // אחרת היינו מתריעים לנצח מול ריסיבר תקין לגמרי
    expect(clickerLinkMessage(null, 'connected')).toBeNull();
  });

  it('★ הפורט תפוס — זו החוליה הראשונה, וההודעה גוברת על השאר', () => {
    // גם כששני הצדדים האחרים "תקינים", אם איננו מאזינים שום דבר לא יעבוד —
    // והודעה על "לחצו Connect" רק תשלח את המנחה לרדוף אחרי הדבר הלא נכון.
    const msg = clickerLinkMessage(false, 'disconnected', { listening: false, port: 8090, busy: true });
    expect(msg).toContain('8090');
    expect(msg).toContain('תפוס');
    expect(msg).toContain('תתחבר לבד'); // ★ אומר שההתאוששות אוטומטית
    expect(msg).not.toContain('Connect');
  });

  it('השרת מאזין — לא מוסיף רעש, ההודעות הרגילות חלות', () => {
    const ok = { listening: true, port: 8090 };
    expect(clickerLinkMessage(true, 'connected', ok)).toBeNull();
    expect(clickerLinkMessage(false, 'connected', ok)).toContain('אינה מחוברת לתוכנת המשחק');
  });

  it('כשל פתיחת פורט שאינו "תפוס" — הודעה אחרת', () => {
    const msg = clickerLinkMessage(null, null, { listening: false, port: 8090 });
    expect(msg).toContain('לא הצלחנו לפתוח');
  });

  it('אין דיווח שרת (גרסה ישנה) — התנהגות כמו קודם', () => {
    expect(clickerLinkMessage(true, 'connected', null)).toBeNull();
    expect(clickerLinkMessage(true, 'connected')).toBeNull();
  });

  it('כל מצב שאינו תקין מחזיר הודעה — אף מצב לא נשאר שקט', () => {
    const states: [boolean | null, string | null][] = [
      [false, null],
      [false, 'connecting'],
      [false, 'disconnected'],
      [true, 'not_connected'],
      [null, 'disconnected'],
      [null, 'connecting'],
    ];
    for (const [sw, dg] of states) {
      expect(clickerLinkMessage(sw, dg), `software=${sw} dongle=${dg}`).not.toBeNull();
    }
  });
});
