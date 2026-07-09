import { useCallback, useSyncExternalStore } from 'react';
import type { GameEngine, GameState } from '../engine/index.ts';

/** חיבור ה-state של המנוע ל-React דרך useSyncExternalStore (SPEC סעיף 10). */
export function useEngineState(engine: GameEngine): GameState {
  const subscribe = useCallback((cb: () => void) => engine.subscribe(cb), [engine]);
  const getSnapshot = useCallback(() => engine.getState(), [engine]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
