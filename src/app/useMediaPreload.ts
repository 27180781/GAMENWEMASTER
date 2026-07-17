/**
 * Hook לטעינה מוקדמת של כל מדיית המשחק. מתחיל ברגע שיש קובץ משחק (מסך
 * ההגדרות), ממשיך לאורך המשחק (אותו id → לא מתחיל מחדש), ומחזיר את מצב
 * ההתקדמות לחיווי. done=true כשאין מה לטעון או כשהכול הסתיים.
 */

import { useEffect, useState } from 'react';
import type { GameFile } from '../engine/index.ts';
import { orderedMediaUrls, preloadMediaList, type PreloadProgress } from './mediaLoader.ts';

export interface MediaPreloadState extends PreloadProgress {
  done: boolean;
}

const IDLE: MediaPreloadState = { total: 0, loaded: 0, failed: 0, done: true };

export function useMediaPreload(game: GameFile | null): MediaPreloadState {
  const [state, setState] = useState<MediaPreloadState>(IDLE);
  const gameId = game?.id ?? '';
  useEffect(() => {
    if (game === null) {
      setState(IDLE);
      return undefined;
    }
    const urls = orderedMediaUrls(game);
    if (urls.length === 0) {
      setState(IDLE);
      return undefined;
    }
    setState({ total: urls.length, loaded: 0, failed: 0, done: false });
    const controller = new AbortController();
    void preloadMediaList(urls, {
      signal: controller.signal,
      onProgress: (p) => setState({ ...p, done: p.loaded + p.failed >= p.total }),
    });
    return () => controller.abort();
    // מפתח לפי id בלבד — מעבר מ-pendingGame לאותו משחק פעיל לא מפעיל טעינה מחדש.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);
  return state;
}
