/**
 * מה שהמנחה והצופה חולקים בווידאו המנחה: הקריאות לשרת (‎/live/<W>/video/…‎,
 * server/live-video.mjs) וההמתנות של WebRTC. החיבור עצמו הוא ישירות מול
 * Cloudflare; השרת רק מעביר את ה-SDP ושומר על הסוד ועל ההרשאות.
 */

export type VideoKind = 'video' | 'audio';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** מה שמסך הצפייה צריך לדעת על השידור — עובר במצב המסך (types.ts). */
export interface LiveVideo {
  /** מזהה השידור. מתחלף כשהמנחה פותח שידור חדש — והצופים מתחברים מחדש. */
  gen: string;
  cam: boolean;
  mic: boolean;
}

export interface VideoReply {
  status: number;
  /** null = לא הגיעה תשובה בכלל (רשת). */
  body: Record<string, unknown> | null;
}

export const DEFAULT_ICE: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** קריאה ל-‎/live/<W>/video/<action>‎. לא זורקת: כשל רשת = status 0. */
export async function videoCall(
  fetchImpl: typeof fetch,
  relayBase: string,
  viewToken: string,
  action: string,
  body: Record<string, unknown>,
  publishKey: string | null = null,
  options: { keepalive?: boolean; timeoutMs?: number } = {},
): Promise<VideoReply> {
  try {
    const res = await fetchImpl(`${relayBase}/${viewToken}/video/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(publishKey === null ? {} : { 'x-live-key': publishKey }),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      ...(options.keepalive === true ? { keepalive: true } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, body: json };
  } catch {
    return { status: 0, body: null };
  }
}

export function errorOf(reply: VideoReply): string {
  const error = reply.body?.error;
  return typeof error === 'string'
    ? error
    : reply.status === 0
      ? 'network'
      : `http-${reply.status}`;
}

export function iceServersOf(value: unknown): IceServer[] {
  if (!Array.isArray(value)) return DEFAULT_ICE;
  const servers = value.filter(
    (s): s is IceServer =>
      s !== null &&
      typeof s === 'object' &&
      (typeof (s as IceServer).urls === 'string' || Array.isArray((s as IceServer).urls)),
  );
  return servers.length > 0 ? servers : DEFAULT_ICE;
}

/**
 * Cloudflare רוצה את ה-SDP עם המועמדים (בלי trickle). מחכים לסיום האיסוף,
 * אבל לא יותר מ-`timeoutMs` — מועמדי המחשב עצמו מגיעים מיד, ומספיקים לרוב.
 */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** עד שהחיבור ל-Cloudflare עולה. נכשל כשהוא נכשל, נסגר, או לא עולה בזמן. */
export function waitForConnected(pc: RTCPeerConnection, timeoutMs = 15_000): Promise<void> {
  if (pc.connectionState === 'connected') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error: Error | null) => {
      clearTimeout(timer);
      pc.removeEventListener('connectionstatechange', check);
      if (error === null) resolve();
      else reject(error);
    };
    const check = () => {
      if (pc.connectionState === 'connected') finish(null);
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed')
        finish(new Error(`connection ${pc.connectionState}`));
    };
    const timer = setTimeout(() => finish(new Error('connection timeout')), timeoutMs);
    pc.addEventListener('connectionstatechange', check);
  });
}

/** המתנה שאפשר לבטל (עצירה באמצע ניסיון חוזר). */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** המתנה הולכת וגדלה בין ניסיונות: 1, 2, 4, 8 … עד `maxMs`. */
export function backoffMs(failures: number, maxMs = 15_000): number {
  if (failures <= 0) return 0;
  return Math.min(maxMs, 1000 * 2 ** Math.min(failures - 1, 5));
}
