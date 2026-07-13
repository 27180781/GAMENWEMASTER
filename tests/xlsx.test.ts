/**
 * הכותב המינימלי של XLSX (xlsx.ts) — בונה חוברת עבודה, מפרק אותה בחזרה עם
 * JSZip ומוודא מבנה תקין: שמות גליונות, כותרת מודגשת, מספרים כמספרים.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildXlsxBlob } from '../src/app/xlsx.ts';

async function unzip(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

describe('buildXlsxBlob', () => {
  it('בונה חוברת עבודה עם הגליונות והתאים הנכונים', async () => {
    const blob = await buildXlsxBlob([
      { name: 'משתתפים', rows: [['שם', 'ניקוד'], ['דנה', 51], ['רון', 0]] },
      { name: 'קבוצות', rows: [['קבוצה'], ['אריות']] },
    ]);
    const zip = await unzip(blob);
    // חלקי החובה קיימים
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml',
      'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      expect(zip.file(part), part).not.toBeNull();
    }
    const workbook = await zip.file('xl/workbook.xml')!.async('string');
    expect(workbook).toContain('name="משתתפים"');
    expect(workbook).toContain('name="קבוצות"');

    const sheet1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet1).toContain('rightToLeft="1"');           // גליון RTL
    expect(sheet1).toContain('<is><t xml:space="preserve">דנה</t></is>'); // מחרוזת מוטבעת
    expect(sheet1).toContain('<v>51</v>');                  // מספר נשמר כמספר
    expect(sheet1).toMatch(/<c r="A1"[^>]*s="1"/);          // שורת כותרת מודגשת
    // 0 הוא ערך מספרי אמיתי (לא ריק)
    expect(sheet1).toContain('<v>0</v>');
  });

  it('מנקה שמות גליונות לא-חוקיים ומייחד כפילויות', async () => {
    const blob = await buildXlsxBlob([
      { name: 'a/b:c', rows: [['x']] },
      { name: 'dup', rows: [['y']] },
      { name: 'dup', rows: [['z']] },
    ]);
    const workbook = await (await unzip(blob)).file('xl/workbook.xml')!.async('string');
    expect(workbook).toContain('name="a b c"'); // תווים אסורים הוחלפו ברווח
    expect(workbook).toContain('name="dup"');
    expect(workbook).toContain('name="dup 2"'); // כפילות מיוחדת
  });
});
