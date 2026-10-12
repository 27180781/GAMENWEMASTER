/**
 * מה שבדיקות הווידאו בשרת חולקות (liveVideo.test.ts, liveStage.test.ts): משחק,
 * חדר ומפתחות, ו-Cloudflare + get-game-json מדומים כ-fetch.
 */

import { createHash } from 'node:crypto';
// @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
import { viewTokenFor } from '../server/live-relay.mjs';

export const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export const GAME = '0b5e8a52-6f0c-4d7e-9a51-7c2d3e4f5a6b';
export const ROOM = '2047';
export const KEY = sha(`trivia-live-pub:v1:${GAME}:${ROOM}`);
export const TOKEN: string = viewTokenFor(KEY);
export const CF = 'https://cf.test/v1';
export const GAME_JSON = 'https://games.test/get-game-json?gameId=';

export interface CfCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  auth: string | null;
}

/** Cloudflare + get-game-json מדומים, כ-fetch. */
export function fakeWorld() {
  const calls: CfCall[] = [];
  const games = new Map<string, unknown>();
  const sessions = new Map<string, { local: Map<string, string> }>();
  let gameFetches = 0;
  let failNext: string | null = null;
  let n = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(GAME_JSON)) {
      gameFetches += 1;
      const game = games.get(decodeURIComponent(url.slice(GAME_JSON.length)));
      return game === undefined ? json(404, { error: 'not found' }) : json(200, game);
    }
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const headers = new Headers(init?.headers);
    const path = url.slice(CF.length);
    calls.push({ method: init?.method ?? 'GET', path, body, auth: headers.get('authorization') });
    if (failNext !== null && path.endsWith(failNext)) {
      failNext = null;
      return json(500, { errorCode: 'internal_error' });
    }
    if (path.startsWith('/turn/keys/')) {
      return json(201, {
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
          {
            urls: [
              'turn:turn.cloudflare.com:3478?transport=udp',
              'turn:turn.cloudflare.com:53?transport=udp',
            ],
            username: 'u',
            credential: 'c',
          },
        ],
      });
    }
    const m = /^\/apps\/APP\/sessions\/([^/]+)(?:\/(.+))?$/.exec(path);
    if (m === null) return json(404, { errorCode: 'not_found' });
    const [, session, rest] = m;
    if (session === 'new') {
      n += 1;
      const id = `sess${n}`;
      sessions.set(id, { local: new Map() });
      return json(201, { sessionId: id });
    }
    const s = sessions.get(session ?? '');
    if (s === undefined) return json(410, { errorCode: 'session_error' });
    if (rest === 'tracks/new') {
      const tracks = (body?.tracks ?? []) as Array<Record<string, unknown>>;
      if (body?.sessionDescription !== undefined) {
        for (const t of tracks) s.local.set(String(t.trackName), String(t.mid));
        return json(200, {
          requiresImmediateRenegotiation: false,
          tracks: tracks.map((t) => ({ trackName: t.trackName, mid: t.mid })),
          sessionDescription: { type: 'answer', sdp: `answer:${session}` },
        });
      }
      return json(200, {
        requiresImmediateRenegotiation: true,
        tracks: tracks.map((t, i) => {
          const owner = sessions.get(String(t.sessionId));
          return owner?.local.has(String(t.trackName))
            ? { sessionId: t.sessionId, trackName: t.trackName, mid: String(i) }
            : { trackName: t.trackName, errorCode: 'track_not_found' };
        }),
        sessionDescription: { type: 'offer', sdp: `offer:${session}` },
      });
    }
    if (rest === 'renegotiate') return json(200, {});
    if (rest === 'tracks/close') {
      return json(200, {
        requiresImmediateRenegotiation: false,
        tracks: ((body?.tracks ?? []) as Array<{ mid: string }>).map((t) => ({ mid: t.mid })),
      });
    }
    return json(404, { errorCode: 'not_found' });
  };

  return {
    calls,
    games,
    fetch: fetchImpl,
    gameFetches: () => gameFetches,
    failNext: (suffix: string) => {
      failNext = suffix;
    },
  };
}

export function entitledGame(overrides: Record<string, unknown> = {}) {
  return {
    name: 'משחק',
    id: GAME,
    room: Number(ROOM),
    setting: { hostVideo: true, limit: { type: 'phones', number: 2 } },
    ...overrides,
  };
}
