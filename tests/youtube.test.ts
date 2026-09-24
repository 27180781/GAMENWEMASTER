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
import { classifyMediaUrl, youtubeEmbedUrl, youtubeStartSeconds, youtubeVideoId } from '../src/engine/index.ts';

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
