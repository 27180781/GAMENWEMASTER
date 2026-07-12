/**
 * בדיקות ל-AudioManager — סאונד אחד בכל רגע: סאונד חדש עוצר את כל הקודמים,
 * כדי שלא יתערבבו כמה יחד. (Audio ו-window מדומים לסביבת Node.)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../src/app/AudioManager.ts';

class FakeAudio {
  static instances: FakeAudio[] = [];
  paused = false;
  playing = false;
  loop = false;
  volume = 1;
  private handlers: Record<string, () => void> = {};

  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
  addEventListener(type: string, cb: () => void): void {
    this.handlers[type] = cb;
  }
  play(): Promise<void> {
    this.playing = true;
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.playing = false;
    this.paused = true;
  }
}

function setup(): AudioManager {
  FakeAudio.instances = [];
  const listeners: Record<string, () => void> = {};
  vi.stubGlobal('window', {
    addEventListener: (type: string, cb: () => void) => (listeners[type] = cb),
    removeEventListener: () => {},
  });
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
  const manager = new AudioManager();
  listeners.keydown?.(); // שחרור נעילת ה-autoplay (אינטראקציה ראשונה)
  return manager;
}

afterEach(() => vi.unstubAllGlobals());

describe('AudioManager — סאונד אחד בכל רגע', () => {
  it('סאונד חדש עוצר את הקודם, גם בערוץ אחר', () => {
    const manager = setup();
    manager.play('showQuestion', 'q.mp3');
    manager.play('timer', 't.mp3', { loop: true });
    const q = FakeAudio.instances[0]!;
    const t = FakeAudio.instances[1]!;
    expect(q.playing).toBe(false); // הקודם נעצר
    expect(q.paused).toBe(true);
    expect(t.playing).toBe(true); // רק החדש מתנגן
    expect(t.loop).toBe(true);
  });

  it('בכל רגע נתון מתנגן לכל היותר אלמנט אחד', () => {
    const manager = setup();
    manager.play('playersConnecting', 'a.mp3', { loop: true });
    manager.play('showQuestion', 'b.mp3');
    manager.play('timer', 'c.mp3', { loop: true });
    const playing = FakeAudio.instances.filter((a) => a.playing);
    expect(playing).toHaveLength(1);
    expect(playing[0]!.src).toBe('c.mp3');
  });

  it('src ריק/null עוצר את מה שמתנגן', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.play('timer', null);
    expect(FakeAudio.instances.every((a) => !a.playing)).toBe(true);
  });

  it('stopAll עוצר הכול', () => {
    const manager = setup();
    manager.play('winners', 'w.mp3');
    manager.stopAll();
    expect(FakeAudio.instances.every((a) => !a.playing)).toBe(true);
  });
});
