/**
 * «במה» ב-React: המסך הראשי (`useStageHost` — פתיחה, סגירה, מי על הבמה),
 * הצפייה במצלמות (`useStageReceiver` — הצופים, חלונית הבמה והתצוגה המקדימה
 * של המנחה), והמצלמה של המשתתף בקישור הצפייה (`useStageCam`).
 *
 * הבמה זמינה רק כשקובץ המשחק מסמן אותה (`setting.hostVideoStage`) ווידאו המנחה
 * זמין; השרת בודק את אותו שדה בעצמו. שום כשל כאן לא נוגע במשחק.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { livePublishKey, liveRelayBase, liveViewToken, normalizeRoom } from '../token.ts';
import { randomId, type VideoStage } from './api.ts';
import { stageCid } from './stage.ts';
import { STAGE_CAM_OFF, StageCamPublisher, stageCamOn, type StageCamState } from './stageCam.ts';
import {
  liveStageOfHost,
  STAGE_HOST_CLOSED,
  StageHostController,
  type StageHostState,
} from './stageHost.ts';
import {
  STAGE_VIEW_IDLE,
  StageReceiver,
  type StageLayer,
  type StageViewState,
} from './stageReceiver.ts';

/** איך מגיעים לבמה של המשחק הזה. `publishKey` — רק למסך הראשי. */
export interface StageKeys {
  relayBase: string;
  viewToken: string;
  publishKey: string | null;
}

// ---------------------------------------------------------------------- המנחה

export interface StageHostHandle {
  /** הרישיון כולל במה, ווידאו המנחה זמין. */
  available: boolean;
  state: StageHostState;
  /** מה שנשלח לצופים במצב המסך. */
  live: VideoStage | null;
  keys: StageKeys | null;
  open: () => void;
  close: () => void;
  put: (id: string) => void;
  remove: (id: string) => void;
  block: (id: string) => void;
  clear: () => void;
}

export function useStageHost({
  enabled,
  gameId,
  roomId,
  gen,
}: {
  enabled: boolean;
  gameId: string;
  roomId: string;
  /** מזהה השידור של וידאו המנחה, או null כשהוא כבוי. */
  gen: string | null;
}): StageHostHandle {
  const [state, setState] = useState<StageHostState>(STAGE_HOST_CLOSED);
  const [keys, setKeys] = useState<StageKeys | null>(null);
  const controllerRef = useRef<StageHostController | null>(null);
  const genRef = useRef(gen);
  genRef.current = gen;

  const active = enabled && gameId.trim() !== '' && roomId.trim() !== '';

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let controller: StageHostController | null = null;
    void (async () => {
      try {
        const publishKey = await livePublishKey(gameId, roomId);
        const viewToken = await liveViewToken(publishKey);
        if (cancelled) return;
        const relayBase = liveRelayBase();
        controller = new StageHostController({
          relayBase,
          viewToken,
          publishKey,
          gameId: gameId.trim(),
          room: normalizeRoom(roomId),
          onState: setState,
        });
        controller.setGen(genRef.current);
        controllerRef.current = controller;
        setKeys({ relayBase, viewToken, publishKey });
      } catch {
        // אין Web Crypto (הקשר לא מאובטח) — אין שידור, וגם לא במה.
      }
    })();
    return () => {
      cancelled = true;
      controller?.dispose();
      controllerRef.current = null;
      setKeys(null);
      setState(STAGE_HOST_CLOSED);
    };
  }, [active, gameId, roomId]);

  useEffect(() => {
    controllerRef.current?.setGen(gen);
  }, [gen, keys]);

  const open = useCallback(() => controllerRef.current?.open(), []);
  const close = useCallback(() => controllerRef.current?.close(), []);
  const put = useCallback((id: string) => controllerRef.current?.put(id), []);
  const remove = useCallback((id: string) => controllerRef.current?.remove(id), []);
  const block = useCallback((id: string) => controllerRef.current?.block(id), []);
  const clear = useCallback(() => controllerRef.current?.clear(), []);
  const live = useMemo(() => liveStageOfHost(state), [state]);

  return {
    available: active && keys !== null,
    state,
    live,
    keys,
    open,
    close,
    put,
    remove,
    block,
    clear,
  };
}

// ---------------------------------------------------------------------- צפייה

/**
 * מתחבר למצלמות `ids` (ריק = לא מתחבר), ומתחבר מחדש כשהרשימה או הגרסה
 * מתחלפות. `jitterMs` — לצופים, כדי שלא יתחברו כולם באותו רגע.
 */
export function useStageReceiver({
  keys,
  ids,
  version,
  layer,
  jitterMs = 0,
}: {
  keys: StageKeys | null;
  ids: readonly string[];
  version: string;
  layer: StageLayer;
  jitterMs?: number;
}): StageViewState {
  const [state, setState] = useState<StageViewState>(STAGE_VIEW_IDLE);
  const receiverRef = useRef<StageReceiver | null>(null);
  const idsKey = ids.join(',');
  const wantRef = useRef({ idsKey, version, layer });
  wantRef.current = { idsKey, version, layer };

  const relayBase = keys?.relayBase ?? null;
  const viewToken = keys?.viewToken ?? null;
  const publishKey = keys?.publishKey ?? null;

  useEffect(() => {
    if (relayBase === null || viewToken === null) return undefined;
    const receiver = new StageReceiver({
      relayBase,
      viewToken,
      publishKey,
      jitterMs,
      onState: setState,
    });
    receiverRef.current = receiver;
    const want = () => {
      const w = wantRef.current;
      receiver.want(w.idsKey === '' ? [] : w.idsKey.split(','), w.version, w.layer);
    };
    want();
    // יציאה מהדף: לפנות את המקום מיד (sendBeacon). חזרה מהמטמון של הדפדפן — שוב.
    const onPageHide = () => receiver.stop();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) want();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      receiver.stop();
      receiverRef.current = null;
      setState(STAGE_VIEW_IDLE);
    };
  }, [relayBase, viewToken, publishKey, jitterMs]);

  useEffect(() => {
    receiverRef.current?.want(idsKey === '' ? [] : idsKey.split(','), version, layer);
  }, [idsKey, version, layer]);

  return state;
}

// ---------------------------------------------------------------------- המשתתף

export interface StageCamHandle {
  state: StageCamState;
  start: (name: string) => void;
  stop: () => void;
}

/** אחסון החלון, אם יש (בלי אחסון — מזהה לביקור הזה בלבד). */
function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** כמה זמן הבמה צריכה להיעלם ממצב המסך לפני שהמצלמה נכבית (לא בהבהוב). */
const CLOSED_GRACE_MS = 2000;

export function useStageCam({
  relayBase,
  viewToken,
  open,
}: {
  relayBase: string;
  viewToken: string;
  /** הבמה פתוחה (לפי מצב המסך). */
  open: boolean;
}): StageCamHandle {
  const [state, setState] = useState<StageCamState>(STAGE_CAM_OFF);
  const camRef = useRef<StageCamPublisher | null>(null);

  useEffect(() => {
    const cam = new StageCamPublisher({
      relayBase,
      viewToken,
      cid: stageCid(tabStorage(), randomId),
      onState: setState,
    });
    camRef.current = cam;
    // סגירת הדף: המצלמה נכבית אצל המנחה ואצל כולם מיד.
    const onPageHide = () => cam.stop();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      cam.dispose();
      camRef.current = null;
      setState(STAGE_CAM_OFF);
    };
  }, [relayBase, viewToken]);

  // הבמה נסגרה — המצלמה נכבית (אחרי רגע: מסך ראשי שמתחבר מחדש לא מכבה אותה).
  const on = stageCamOn(state);
  useEffect(() => {
    if (open || !on) return undefined;
    const timer = setTimeout(() => camRef.current?.closed(), CLOSED_GRACE_MS);
    return () => clearTimeout(timer);
  }, [open, on]);

  const start = useCallback((name: string) => {
    void camRef.current?.start(name);
  }, []);
  const stop = useCallback(() => camRef.current?.stop(), []);

  return { state, start, stop };
}
