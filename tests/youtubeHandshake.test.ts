/**
 * לחיצת היד עם נגן היוטיוב. הבאג: "listening" נשלח רק פעמיים (load ו-1.5 שנ'),
 * ואם שתיהן אבדו ב-Wi-Fi איטי הנגן לא ענה לעולם — סרטון שמתנגן בפועל הוסר
 * אחרי 8 שנ' והוצג מסך שגיאה.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALIVE_TIMEOUT_MS,
  LISTEN_INTERVAL_MS,
  startYoutubeHandshake,
} from '../src/render/youtubeHandshake.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('לחיצת יד עם נגן היוטיוב', () => {
  it('★ "listening" נשלח שוב ושוב עד התשובה הראשונה — גם אחרי 1.5 שנ\'', () => {
    const send = vi.fn();
    startYoutubeHandshake({ send });
    vi.advanceTimersByTime(4000);
    // הרבה יותר משתי הזדמנויות: נגן שהחמיץ את הראשונות עדיין שומע אותנו
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(Math.floor(4000 / LISTEN_INTERVAL_MS));
  });

  it('★ נגן שעונה רק לבקשה מאוחרת (אחרי 5 שנ\') אינו מוכרז ככושל', () => {
    const onTimeout = vi.fn();
    let playerReady = false;
    const hs = startYoutubeHandshake({
      // הנגן מתעורר רק אחרי 5 שנ' — כל בקשה לפני כן הולכת לאיבוד
      send: () => {
        if (playerReady) hs.markAlive();
      },
      onTimeout,
    });
    vi.advanceTimersByTime(5000);
    playerReady = true;
    vi.advanceTimersByTime(ALIVE_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('אחרי התשובה הראשונה השליחה נעצרת', () => {
    const send = vi.fn();
    const hs = startYoutubeHandshake({ send });
    vi.advanceTimersByTime(LISTEN_INTERVAL_MS * 2);
    hs.markAlive();
    const sent = send.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(send.mock.calls.length).toBe(sent);
    hs.sendNow(); // גם load מאוחר לא שולח שוב
    expect(send.mock.calls.length).toBe(sent);
  });

  it('★ כשל אמיתי (הנגן לא עונה לשום בקשה) עדיין מזוהה', () => {
    const onTimeout = vi.fn();
    startYoutubeHandshake({ send: () => {}, onTimeout });
    vi.advanceTimersByTime(ALIVE_TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('ברקע (בלי onTimeout) — שתיקה אינה זורקת ואינה מסירה כלום', () => {
    const hs = startYoutubeHandshake({ send: () => {} });
    expect(() => vi.advanceTimersByTime(ALIVE_TIMEOUT_MS * 2)).not.toThrow();
    hs.dispose();
  });

  it('dispose עוצר הכול', () => {
    const send = vi.fn();
    const onTimeout = vi.fn();
    const hs = startYoutubeHandshake({ send, onTimeout });
    hs.dispose();
    vi.advanceTimersByTime(ALIVE_TIMEOUT_MS * 2);
    expect(send).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
