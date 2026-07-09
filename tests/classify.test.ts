import { describe, expect, it } from 'vitest';
import {
  classifyMediaUrl,
  classifySubjectSlide,
  extractDynamicImageUrl,
} from '../src/engine/index.ts';
import { loadFixture } from './helpers.ts';

describe('classifySubjectSlide — מול הטקסטים האמיתיים מהקבצים', () => {
  const masaa = loadFixture('masaa-sync-manual-link.json');
  const que = (id: number): string => {
    const slide = masaa.questions.find((s) => s.id === id);
    if (!slide) throw new Error(`שקופית id=${id} לא נמצאה`);
    return slide.question.que;
  };

  it('שקופיות image_URL עם {{GAMA_ID}} מזוהות כ-dynamic-image', () => {
    for (const id of [1, 62, 63, 64]) {
      expect(classifySubjectSlide(que(id)), `שקופית id=${id}`).toBe('dynamic-image');
    }
  });

  it('שקופית Send_data מזוהה כ-send-data', () => {
    expect(que(59)).toBe('Send_data');
    expect(classifySubjectSlide(que(59))).toBe('send-data');
  });

  it('שקופיות טקסט רגילות ("סגרו את הכרטיסיה" וכדומה) מזוהות כ-plain', () => {
    for (const id of [66, 67, 68, 69, 70, 71]) {
      expect(classifySubjectSlide(que(id)), `שקופית id=${id}`).toBe('plain');
    }
    expect(que(68)).toBe('סגרו את הכרטיסיה כעת');
  });

  it('שקופית subject של שיתוף (beficha) היא plain', () => {
    const beficha = loadFixture('beficha-uvilvavcha.json');
    const subject = beficha.questions.find((s) => s.type === 'subject');
    expect(subject).toBeDefined();
    expect(classifySubjectSlide(subject!.question.que)).toBe('plain');
  });

  it('כיסוי מלא: כל שקופיות ה-subject בכל הקבצים מסווגות לערך חוקי', () => {
    for (const name of [
      'hadassah-ozen.json',
      'masaa-sync-manual-link.json',
      'beficha-uvilvavcha.json',
      'neuwirth.json',
    ]) {
      const game = loadFixture(name);
      for (const slide of game.questions) {
        if (slide.type !== 'subject') continue;
        expect(['dynamic-image', 'send-data', 'plain']).toContain(
          classifySubjectSlide(slide.question.que),
        );
      }
    }
  });
});

describe('extractDynamicImageUrl — החלפת {{GAMA_ID}}', () => {
  it('מחלץ את ה-URL ומחליף את המזהה', () => {
    const que = 'image_URL\nhttps://masaa.clicker.co.il/images/license-status/{{GAMA_ID}}.png';
    expect(extractDynamicImageUrl(que, 'my-game-id')).toBe(
      'https://masaa.clicker.co.il/images/license-status/my-game-id.png',
    );
  });

  it('מחזיר null לשקופית שאינה dynamic-image', () => {
    expect(extractDynamicImageUrl('סגרו את הכרטיסיה כעת', 'x')).toBeNull();
    expect(extractDynamicImageUrl('Send_data', 'x')).toBeNull();
  });
});

describe('classifyMediaUrl — זיהוי לפי URL בלבד (assets[].type לא אמין)', () => {
  it('YouTube embed מזוהה גם כשהוא רשום כ-image ב-assets', () => {
    const masaa = loadFixture('masaa-sync-manual-link.json');
    const youtubeAssets = masaa.assets.filter((a) => a.src.includes('youtube.com'));
    expect(youtubeAssets.length).toBeGreaterThan(0);
    for (const asset of youtubeAssets) {
      expect(asset.type).toBe('image'); // השדה משקר
      expect(classifyMediaUrl(asset.src)).toBe('youtube'); // הזיהוי לפי URL
    }
  });

  it('מזהה סוגים לפי סיומת', () => {
    expect(classifyMediaUrl('https://example.com/a/b/pic.jpg')).toBe('image');
    expect(classifyMediaUrl('https://example.com/pic.PNG?w=100')).toBe('image');
    expect(classifyMediaUrl('https://example.com/movie.mp4')).toBe('video');
    expect(classifyMediaUrl('https://example.com/sound.mp3')).toBe('audio');
    expect(classifyMediaUrl('https://youtu.be/abc123')).toBe('youtube');
    expect(classifyMediaUrl('https://www.youtube.com/embed/gE2KPiDAfLw')).toBe('youtube');
  });

  it('URL בלי סיומת או ריק — unknown', () => {
    expect(classifyMediaUrl('https://r2-cors-proxy.example.dev/system-media/123-abc')).toBe(
      'unknown',
    );
    expect(classifyMediaUrl('')).toBe('unknown');
    expect(classifyMediaUrl('https://example.com/file.xyz')).toBe('unknown');
  });

  it('מכסה את כל המדיה בקבצים האמיתיים ללא הפתעות', () => {
    const masaa = loadFixture('masaa-sync-manual-link.json');
    for (const slide of masaa.questions) {
      for (const src of [slide.openMedia.src, slide.endMedia.src, slide.backgroundMedia.src]) {
        if (src === '') continue;
        expect(['youtube', 'image', 'video', 'audio']).toContain(classifyMediaUrl(src));
      }
    }
  });
});
