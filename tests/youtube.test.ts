/**
 * המרת קישור יוטיוב לצורה שניתנת להטמעה.
 *
 * הבאג שזה פותר: ‎youtube.com/watch?v=…‎ הוזרם ישירות ל-iframe, ויוטיוב מסרב
 * להיות ממוסגר בעמוד ה-watch. על המסך הגדול זה נראה כריבוע אפור עם סמל "עמוד
 * שבור" — בלי הודעת שגיאה, ובלי רמז שהבעיה היא בצורת הכתובת.
 *
 * אומת בהרצה שזה אכן מה שקורה: עמוד עם ‎X-Frame-Options: SAMEORIGIN‎ שממוסגר
 * מ-origin אחר מציג בדיוק את הסמל הזה, ואותו עמוד תחת ‎/embed‎ נטען כרגיל.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyMediaUrl,
  isYoutubeUrl,
  youtubeEmbedUrl,
  youtubeStartSeconds,
  youtubeVideoId,
} from '../src/engine/index.ts';

const ID = 'EEQdTNk3kmM';

describe('זיהוי מזהה הסרטון', () => {
  it('★ הצורה שמדביקים מהדפדפן — watch?v=', () => {
    expect(youtubeVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('★ כל שאר הצורות המוכרות', () => {
    for (const url of [
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/v/${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `https://youtube.com/watch?v=${ID}`,
    ]) {
      expect(youtubeVideoId(url), url).toBe(ID);
    }
  });

  it('פרמטרים נוספים אינם מבלבלים', () => {
    expect(youtubeVideoId(`https://www.youtube.com/watch?app=desktop&v=${ID}&t=42s`)).toBe(ID);
  });

  it('★ מה שאינו יוטיוב מוחזר null', () => {
    for (const url of [
      'https://vimeo.com/12345',
      'https://example.com/watch?v=EEQdTNk3kmM',
      'Assets/video.mp4',
      '',
      'not a url',
      'https://www.youtube.com/',
      'https://www.youtube.com/watch?v=short',
    ]) {
      expect(youtubeVideoId(url), JSON.stringify(url)).toBeNull();
    }
  });
});

describe('זמן התחלה', () => {
  it('שניות, וגם 1m30s / 1h2m3s', () => {
    expect(youtubeStartSeconds('90')).toBe(90);
    expect(youtubeStartSeconds('90s')).toBe(90);
    expect(youtubeStartSeconds('1m30s')).toBe(90);
    expect(youtubeStartSeconds('1h2m3s')).toBe(3723);
  });

  it('ריק/אפס/שטות — בלי start', () => {
    for (const bad of [null, '', '  ', '0', 'abc', '-5']) {
      expect(youtubeStartSeconds(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('★ כתובת ההטמעה', () => {
  it('★ המקרה שנשבר אצל הלקוח', () => {
    expect(youtubeEmbedUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(
      `https://www.youtube.com/embed/${ID}`,
    );
  });

  it('★ התוצאה היא תמיד /embed/ — הצורה היחידה שיוטיוב מרשה למסגר', () => {
    for (const url of [
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
    ]) {
      expect(youtubeEmbedUrl(url), url).toBe(`https://www.youtube.com/embed/${ID}`);
    }
  });

  it('כתובת embed קיימת נשארת תקינה', () => {
    expect(youtubeEmbedUrl(`https://www.youtube.com/embed/${ID}`)).toBe(
      `https://www.youtube.com/embed/${ID}`,
    );
  });

  it('★ זמן התחלה נשמר', () => {
    expect(youtubeEmbedUrl(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)).toBe(
      `https://www.youtube.com/embed/${ID}?start=90`,
    );
    expect(youtubeEmbedUrl(`https://youtu.be/${ID}?t=42`)).toBe(
      `https://www.youtube.com/embed/${ID}?start=42`,
    );
  });

  it('רשימת השמעה נשמרת', () => {
    expect(youtubeEmbedUrl(`https://www.youtube.com/watch?v=${ID}&list=PL123`)).toBe(
      `https://www.youtube.com/embed/${ID}?list=PL123`,
    );
  });

  it('מה שאינו יוטיוב — null, והנגן משאיר את הכתובת כמו שהיא', () => {
    expect(youtubeEmbedUrl('https://example.com/a.mp4')).toBeNull();
  });
});

describe('הסיווג ממשיך לזהות את אותן כתובות כיוטיוב', () => {
  it('★ אחרת הנגן בכלל לא היה מגיע להמרה', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
    ]) {
      expect(classifyMediaUrl(url), url).toBe('youtube');
    }
  });
});

/**
 * ★ הסיבה השורשית לבאג, ולמה הוא חזר: היו **שתי** רשימות של "מה נחשב יוטיוב"
 * — הביטוי ב-classifyMediaUrl והמנתח ב-youtube.ts — והן נפרדו. קישור shorts
 * עבר בסיווג כ-'unknown' והוצג כטקסט, אף שהמנתח ידע לקרוא אותו מצוין.
 *
 * עכשיו הסיווג קורא למנתח, והבדיקה הזו נועלת את זה: כל צורה שהמנתח מזהה
 * חייבת להיות מסווגת כיוטיוב, ולהיפך.
 */
describe('★ מקור אמת אחד — הסיווג והמנתח לא יכולים להיפרד', () => {
  const FORMS = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ];

  it.each(FORMS)('%s → מסווג כיוטיוב וגם מתורגם ל-embed', (url) => {
    expect(classifyMediaUrl(url)).toBe('youtube');
    expect(youtubeEmbedUrl(url)).toBe(`https://www.youtube.com/embed/${ID}`);
  });

  it('★ מה שאינו יוטיוב אינו מסווג ככזה', () => {
    for (const url of ['https://vimeo.com/123', 'https://cdn.example.com/a.mp4', 'Assets/x.jpg']) {
      expect(classifyMediaUrl(url), url).not.toBe('youtube');
    }
  });
});

/**
 * ★ שני הכיוונים חייבים להישאר עקביים: כל מה שהמנתח יודע לקרוא הוא בוודאי
 * יוטיוב. הכיוון ההפוך *אינו* חייב להתקיים, ובכוונה — קישור יוטיוב עם מזהה
 * משובש עדיין מסווג כיוטיוב, כדי שלא יישלח להורדה מראש ולא ידווח כמדיה שבורה.
 */
describe('★ היחס בין הסיווג הרחב למנתח הצר', () => {
  it('כל מה שהמנתח קורא — מסווג כיוטיוב', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
    ]) {
      expect(youtubeVideoId(url), url).not.toBeNull();
      expect(isYoutubeUrl(url), url).toBe(true);
      expect(classifyMediaUrl(url), url).toBe('youtube');
    }
  });

  it('★ מזהה משובש — עדיין יוטיוב לסיווג, אבל בלי כתובת הטמעה', () => {
    const broken = 'https://youtu.be/abc123';
    expect(isYoutubeUrl(broken)).toBe(true);
    expect(classifyMediaUrl(broken)).toBe('youtube'); // לא יימשך מראש, לא ידווח כשבור
    expect(youtubeVideoId(broken)).toBeNull();
    expect(youtubeEmbedUrl(broken)).toBeNull(); // הנגן ישאיר את הכתובת, ויודיע על כשל
  });

  it('מארח אחר אינו יוטיוב בשום אופן', () => {
    for (const url of ['https://vimeo.com/123', 'https://notyoutube.com/watch?v=x', 'Assets/x.jpg']) {
      expect(isYoutubeUrl(url), url).toBe(false);
    }
  });
});
