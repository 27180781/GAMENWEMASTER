/**
 * וידאו המנחה אצל המסך הראשי: מחזיק את HostVideoPublisher, את רשימת המצלמות
 * והמיקרופונים ואת הבחירה שנשמרה במחשב.
 *
 * זמין רק כשקובץ המשחק אומר שהרישיון כולל את התוספת (`setting.hostVideo`)
 * ובמשחק אונליין עם קוד חדר — אותם תנאים כמו השידור החי עצמו. השרת בודק את
 * הרישיון שוב בעצמו. שום כשל כאן לא נוגע במשחק.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { livePublishKey, liveRelayBase, liveViewToken, normalizeRoom } from '../token.ts';
import type { LiveVideo, VideoKind } from './api.ts';
import {
  HOST_VIDEO_OFF,
  HostVideoPublisher,
  liveVideoOf,
  type HostVideoState,
} from './hostVideo.ts';

export interface DeviceOption {
  id: string;
  label: string;
}

export interface HostVideoHandle {
  /** הרישיון כולל וידאו מנחה והמשחק משדר — אפשר להפעיל. */
  available: boolean;
  state: HostVideoState;
  /** מה שנשלח לצופים במצב המסך. */
  live: LiveVideo | null;
  cameras: DeviceOption[];
  mics: DeviceOption[];
  camera: string | null;
  mic: string | null;
  start: () => void;
  stop: () => void;
  setCam: (on: boolean) => void;
  setMic: (on: boolean) => void;
  choose: (kind: VideoKind, deviceId: string | null) => void;
}

const PREF_KEYS: Record<VideoKind, string> = {
  video: 'trivia.hostVideo.camera',
  audio: 'trivia.hostVideo.mic',
};

function readPref(kind: VideoKind): string | null {
  try {
    return localStorage.getItem(PREF_KEYS[kind]);
  } catch {
    return null;
  }
}

function writePref(kind: VideoKind, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREF_KEYS[kind]);
    else localStorage.setItem(PREF_KEYS[kind], value);
  } catch {
    /* אין אחסון — הבחירה פשוט לא נשמרת */
  }
}

/** לפני אישור הגישה הדפדפן מחזיר רשומות בלי מזהה ובלי שם — אין מה להציג. */
function optionsOf(
  list: MediaDeviceInfo[],
  kind: MediaDeviceKind,
  fallback: string,
): DeviceOption[] {
  return list
    .filter((d) => d.kind === kind && d.deviceId !== '')
    .map((d, i) => ({ id: d.deviceId, label: d.label.trim() || `${fallback} ${i + 1}` }));
}

export function useHostVideo({
  enabled,
  gameId,
  roomId,
}: {
  enabled: boolean;
  gameId: string;
  roomId: string;
}): HostVideoHandle {
  const [state, setState] = useState<HostVideoState>(HOST_VIDEO_OFF);
  const [ready, setReady] = useState(false);
  const publisherRef = useRef<HostVideoPublisher | null>(null);
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [mics, setMics] = useState<DeviceOption[]>([]);
  const [camera, setCamera] = useState<string | null>(() => readPref('video'));
  const [mic, setMicDevice] = useState<string | null>(() => readPref('audio'));

  const active = enabled && gameId.trim() !== '' && roomId.trim() !== '';

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let publisher: HostVideoPublisher | null = null;
    void (async () => {
      try {
        const publishKey = await livePublishKey(gameId, roomId);
        const viewToken = await liveViewToken(publishKey);
        if (cancelled) return;
        publisher = new HostVideoPublisher({
          relayBase: liveRelayBase(),
          viewToken,
          publishKey,
          gameId: gameId.trim(),
          room: normalizeRoom(roomId),
          onState: setState,
        });
        publisherRef.current = publisher;
        setReady(true);
      } catch {
        // אין Web Crypto (הקשר לא מאובטח) — אין שידור, וגם לא וידאו.
      }
    })();
    // סגירת הדף: המצלמה נכבית והשרת מפסיק להעביר לצופים מיד.
    const onPageHide = () => publisher?.stop();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', onPageHide);
      publisher?.dispose();
      publisherRef.current = null;
      setReady(false);
      setState(HOST_VIDEO_OFF);
    };
  }, [active, gameId, roomId]);

  // רשימת המכשירים — אחרי שהדפדפן נתן גישה (רק אז יש שמות), ובכל חיבור/ניתוק.
  const hasStream = state.stream !== null;
  useEffect(() => {
    if (!ready || typeof navigator === 'undefined' || navigator.mediaDevices === undefined) {
      return undefined;
    }
    let cancelled = false;
    const refresh = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((list) => {
          if (cancelled) return;
          setCameras(optionsOf(list, 'videoinput', 'מצלמה'));
          setMics(optionsOf(list, 'audioinput', 'מיקרופון'));
        })
        .catch(() => {});
    };
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [ready, hasStream]);

  const start = useCallback(() => {
    void publisherRef.current?.start({ camera: readPref('video'), mic: readPref('audio') });
  }, []);
  const stop = useCallback(() => publisherRef.current?.stop(), []);
  const setCam = useCallback((on: boolean) => publisherRef.current?.setCam(on), []);
  const setMic = useCallback((on: boolean) => publisherRef.current?.setMic(on), []);
  const choose = useCallback((kind: VideoKind, deviceId: string | null) => {
    writePref(kind, deviceId);
    if (kind === 'video') setCamera(deviceId);
    else setMicDevice(deviceId);
    void publisherRef.current?.switchDevice(kind, deviceId);
  }, []);

  const { phase, gen, cam, mic: micOn } = state;
  const live = useMemo(
    () => liveVideoOf({ ...HOST_VIDEO_OFF, phase, gen, cam, mic: micOn }),
    [phase, gen, cam, micOn],
  );

  return {
    available: active && ready,
    state,
    live,
    cameras,
    mics,
    camera,
    mic,
    start,
    stop,
    setCam,
    setMic,
    choose,
  };
}
