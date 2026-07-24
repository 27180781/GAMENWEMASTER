/**
 * בדיקות לערוץ השליטה (controlChannel) — נתיב ה-EXE (ממסר דרך גשר triviaDesktop):
 * post שולח דרך controlPost, והודעות נכנסות מגיעות ל-onMessage; close מבטל מנוי.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canControlChannel, openControlChannel, type ControlMessage } from '../src/app/controlChannel.ts';

const realWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
  (globalThis as { window?: unknown }).window = realWindow;
});

/** מזריק גשר EXE מדומה עם controlPost/onControl. מחזיר כלים לבדיקה. */
function stubBridge() {
  const posted: unknown[] = [];
  let handler: ((msg: unknown) => void) | null = null;
  const unsub = vi.fn();
  (globalThis as { window?: unknown }).window = {
    triviaDesktop: {
      controlPost: (msg: unknown) => posted.push(msg),
      onControl: (cb: (msg: unknown) => void) => {
        handler = cb;
        return unsub;
      },
    },
  };
  return { posted, deliver: (msg: unknown) => handler?.(msg), unsub };
}

describe('controlChannel — נתיב גשר ה-EXE', () => {
  it('canControlChannel true כשיש גשר', () => {
    stubBridge();
    expect(canControlChannel()).toBe(true);
  });

  it('post שולח דרך controlPost, והודעות נכנסות מגיעות ל-onMessage', () => {
    const { posted, deliver } = stubBridge();
    const received: ControlMessage[] = [];
    const ch = openControlChannel((msg) => received.push(msg));

    ch.post({ t: 'cmd', cmd: 'advance' });
    expect(posted).toEqual([{ t: 'cmd', cmd: 'advance' }]);

    deliver({ t: 'goto', slideId: 7 });
    expect(received).toEqual([{ t: 'goto', slideId: 7 }]);
  });

  it('close מבטל את המנוי', () => {
    const { unsub } = stubBridge();
    const ch = openControlChannel(() => {});
    ch.close();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
