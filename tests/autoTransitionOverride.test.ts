import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_TRANSITION,
  loadAutoTransition,
  saveAutoTransition,
} from '../src/app/urlParams.ts';
import type { AutoTransition } from '../src/engine/schema.ts';

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const GAME = '490e48fa-8c1b-42fc-a988-b320777cbe14';
const withCorrect = (on: boolean): AutoTransition => ({
  ...DEFAULT_AUTO_TRANSITION,
  showCorrectAnswerAfterTimer: on,
});

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = store;
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('autoTransition override', () => {
  it('«התחל» without a change saves nothing, so a later builder change applies', () => {
    saveAutoTransition(GAME, withCorrect(false), withCorrect(false));
    expect(store.map.size).toBe(0);
    expect(loadAutoTransition(GAME, withCorrect(true))).toBeNull();
  });

  it('keeps the operator choice while the file is unchanged', () => {
    saveAutoTransition(GAME, withCorrect(true), withCorrect(false));
    expect(loadAutoTransition(GAME, withCorrect(false))?.showCorrectAnswerAfterTimer).toBe(true);
  });

  it('drops the operator choice once the builder setting changes', () => {
    saveAutoTransition(GAME, { ...withCorrect(false), nextSlide: { active: true, seconds: 8 } }, withCorrect(false));
    expect(loadAutoTransition(GAME, withCorrect(true))).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it('choosing the file value again clears the override', () => {
    saveAutoTransition(GAME, withCorrect(true), withCorrect(false));
    saveAutoTransition(GAME, withCorrect(false), withCorrect(false));
    expect(store.map.size).toBe(0);
  });

  it('ignores and removes the old snapshot saved by every start', () => {
    store.setItem(`trivia:autoTransition:${GAME}`, JSON.stringify(withCorrect(false)));
    expect(loadAutoTransition(GAME, withCorrect(true))).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it('survives garbage and a missing localStorage', () => {
    store.setItem(`trivia:autoTransition:v2:${GAME}`, '{not json');
    expect(loadAutoTransition(GAME, withCorrect(true))).toBeNull();
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadAutoTransition(GAME, withCorrect(true))).toBeNull();
    expect(() => saveAutoTransition(GAME, withCorrect(true), withCorrect(false))).not.toThrow();
  });
});
