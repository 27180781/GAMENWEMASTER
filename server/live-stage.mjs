/**
 * «במה»: מצלמות של משתתפים לכל הצופים במסך הצפייה (‎?view=‎), ליד וידאו המנחה.
 * רץ בתוך וידאו המנחה (server/live-video.mjs), תחת ‎/live/<W>/video/…‎, דרך
 * אותו Cloudflare Realtime SFU ואותו סוד.
 *
 * - **רק כשהמנחה פתח.** את הבמה פותח רק המסך הראשי (מפתח P, כמו וידאו המנחה),
 *   רק כשווידאו המנחה משודר, ורק במשחק שקובץ המשחק שלו מסמן
 *   `setting.hostVideoStage` (בנוסף לכל התנאים של `setting.hostVideo`). כל עוד
 *   היא סגורה, אף משתתף לא יכול להדליק מצלמה.
 * - **המצלמה כבויה עד שהמשתתף מדליק אותה.** משתתף בקישור הצפייה מדליק מצלמה
 *   (בלי מיקרופון), ובהתחלה רק המנחה רואה אותה, בתצוגה המקדימה שלו. המנחה מעלה
 *   עד 9 מצלמות לבמה, ורק אותן רואים כל הצופים והמסך הראשי. המנחה יכול לכבות כל
 *   מצלמה, ומשתתף שכובה לא מדליק שוב עד שעובר זמן (`blockMs`).
 * - **מי המשתתף.** הדף של המשתתף מגריל מזהה פרטי (cid) ושומר אותו; ממנו נגזר
 *   מזהה ציבורי (pid) שהמנחה והצופים רואים. מי שמכיר רק את ה-pid לא יכול להתחזות
 *   למצלמה. אותו משתתף שמתחבר שוב (רשת, ניתוק) מחליף את המצלמה הקודמת שלו ונשאר
 *   על הבמה.
 * - **רק מה שעל הבמה.** צופה מתחבר רק למצלמות שעל הבמה ברגע הבקשה, ומצלמה שירדה
 *   מהבמה נחתכת אצל כל הצופים מיד, עוד לפני שהמסך שלהם התעדכן.
 * - **המנחה קובע.** המסך הראשי שולח בכל סקר (כל ~2 שניות) את מה שהוא רוצה: פתוח
 *   או סגור, ומי על הבמה. מכאן חוזרות המצלמות הדלוקות ומי מהן על הבמה בפועל
 *   (מי שהמצלמה שלו כבתה יורד, וחוזר כשהיא נדלקת שוב). כך גם אחרי הפעלה מחדש
 *   של השרת הבמה חוזרת לבד: המנחה פותח אותה שוב בסקר הבא, והמשתתפים מתחברים שוב.
 *   מסך ראשי שאיבד את השידור למסך אחר מקבל "superseded" ולא משנה כלום.
 *
 * Cloudflare גובה רק על מה שיוצא לצופים: מצלמה שאינה על הבמה עולה רק את
 * התצוגה המקדימה של המנחה (שכבה נמוכה, עד `maxPreview` בבת אחת).
 *
 *   POST /live/<W>/video/stage         מנחה (x-live-key): פתוחה או סגורה, מי על הבמה,
 *                                       כיבוי מצלמות; מחזיר את המצלמות הדלוקות
 *   POST /live/<W>/video/cam-config    משתתף: האם אפשר להדליק, ושרתי ICE
 *   POST /live/<W>/video/cam           משתתף: הצעת SDP ← תשובה, ומזהה מצלמה
 *   POST /live/<W>/video/cam-beat      משתתף: דופק; האם הוא על הבמה
 *   POST /live/<W>/video/cam-stop      משתתף: כיבוי (גם sendBeacon)
 *   POST /live/<W>/video/stage-sub     צופה: הצעת SDP למצלמות שעל הבמה (המנחה:
 *                                       לכל מצלמה דלוקה, לתצוגה המקדימה)
 *   POST /live/<W>/video/stage-answer  צופה: התשובה שלו
 *   POST /live/<W>/video/stage-ping    צופה: דופק; האם צריך להתחבר מחדש
 *   POST /live/<W>/video/stage-leave   צופה: עזב (גם sendBeacon)
 *
 * בלי תלויות — רק Node.
 */

import { createHash, randomBytes } from 'node:crypto';

const CID_RE = /^[0-9a-f]{32}$/;
const PID_RE = /^[0-9a-f]{16}$/;
const HANDLE_RE = /^[0-9a-f]{32}$/;
const MID_RE = /^[0-9A-Za-z_-]{1,32}$/;
const RID_RE = /^[a-z]{1,4}$/;
const PID_PREFIX = 'trivia-stage-pid:v1:';
/** שם הרצועה של מצלמת משתתף בסשן שלה ב-Cloudflare. */
const TRACK = 'cam';

export const STAGE_ACTIONS = [
  'stage',
  'cam-config',
  'cam',
  'cam-beat',
  'cam-stop',
  'stage-sub',
  'stage-answer',
  'stage-ping',
  'stage-leave',
];

export const DEFAULT_STAGE_LIMITS = {
  /** כמה מצלמות על הבמה בבת אחת. */
  maxOnStage: 9,
  /** כמה מצלמות דלוקות בכל משחק (עד שהמנחה מעלה אותן, רק הוא רואה). */
  maxCams: 50,
  /** כמה מצלמות המנחה רואה בבת אחת בתצוגה המקדימה. */
  maxPreview: 12,
  /** כמה צפיות בבת אחת למסך הראשי (גלריה ותצוגה מקדימה, כל אחת עם החלפה). */
  maxHostSubs: 4,
  /** מצלמות בכל השרת. */
  maxCamsTotal: 3000,
  /** המשתתף דופק כל ~10 שניות; מצלמה ששתקה יותר מזה נכבית. */
  camTimeoutMs: 35_000,
  /** המנחה שואל כל ~2 שניות כל עוד הבמה פתוחה; במה שהמנחה שלה נעלם נסגרת. */
  hostTimeoutMs: 60_000,
  /** הדלקות מצלמה (והכנות להדלקה) בשנייה לכל משחק, ופרץ. */
  camPerSecond: 8,
  camBurst: 30,
  /** כמה זמן משתתף שהמנחה כיבה לא יכול להדליק שוב. */
  blockMs: 30 * 60_000,
  /** כמה זמן נזכרת הסיבה שמצלמה נכבתה, כדי שהמשתתף יידע למה. */
  endedMemoryMs: 10 * 60_000,
  nameMax: 20,
};

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function newId() {
  return randomBytes(16).toString('hex');
}

/** המזהה הציבורי של מצלמה: נגזר מהמזהה הפרטי של הדף, ולא ניתן לשחזר ממנו את המזהה. */
export function pidFor(token, cid) {
  return sha256(`${PID_PREFIX}${token}:${cid}`).slice(0, 16);
}

/**
 * השם מתחת למצלמה: בלי תווי בקרה וכיווניות (שהופכים טקסט על המסך), רווח
 * אחד בין מילים, ועד `max` תווים.
 */
export function cleanName(value, max = DEFAULT_STAGE_LIMITS.nameMax) {
  if (typeof value !== 'string') return '';
  const text = value
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return [...text].slice(0, max).join('').trim();
}

/** רשימת מזהים ציבוריים מהבקשה: רק תקינים, בלי כפילויות, עד `max`. */
function idList(value, max) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const id of value) {
    if (typeof id === 'string' && PID_RE.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** השכבה ש-Cloudflare שולח: העליונה למסך הראשי, הנמוכה לחלונות קטנים. */
function layerRid(rids, high) {
  const sorted = [...rids].sort();
  return high ? sorted[0] : sorted[sorted.length - 1];
}

/**
 * @param {{
 *   cf: (method: string, path: string, body?: unknown) => Promise<{ status: number, json: any }>,
 *   cfError: (reply: { status: number, json: any }, expectTracks: boolean) => string | null,
 *   newSession: () => Promise<string>,
 *   closeTracks: (sessionId: string, mids: string[]) => void,
 *   iceServers: () => Promise<unknown[]>,
 *   isHost: (req: any, token: string) => boolean,
 *   checkHost: (req: any, token: string, body: any) => Promise<{ status: number, error?: string, ent?: any, gameId?: string }>,
 *   livePub: (token: string) => { gen: string } | null,
 *   configured: boolean,
 *   now: () => number,
 *   log: (line: string) => void,
 *   video: { viewerTimeoutMs: number, pendingTimeoutMs: number, maxViewers: number, maxSdpBytes: number },
 *   limits?: Partial<typeof DEFAULT_STAGE_LIMITS>,
 * }} deps
 */
export function createStage({
  cf,
  cfError,
  newSession,
  closeTracks,
  iceServers,
  isHost,
  checkHost,
  livePub,
  configured,
  now,
  log,
  video,
  limits = {},
}) {
  const cfg = { ...DEFAULT_STAGE_LIMITS, ...limits };

  /** W → הבמה של המשחק. קיימת = פתוחה. */
  const stages = new Map();
  /** handle → מצלמה דלוקה של משתתף. */
  const cams = new Map();
  /** "W:pid" → המצלמה הנוכחית של המשתתף (אחת לכל משתתף). */
  const current = new Map();
  /** handle → צפייה במצלמות (צופה, או המסך הראשי). */
  const subs = new Map();
  /** handle של מצלמה שנכבתה → { reason, at }. */
  const ended = new Map();
  /** W → (pid → עד מתי חסום). נשמר גם כשהבמה נסגרת ונפתחת שוב. */
  const blocks = new Map();
  /** "W:cam" / "W:sub" → דלי אסימונים. */
  const buckets = new Map();
  /** גרסת הבמה: עולה בכל שינוי במי שעליה. מתחיל מהשעה, כדי שגם אחרי הפעלה מחדש יעלה. */
  let seq = now();

  // ------------------------------------------------------------- מצב

  const camKey = (token, pid) => `${token}:${pid}`;

  function camAlive(cam) {
    return now() - cam.beatAt < cfg.camTimeoutMs;
  }

  function subAlive(sub) {
    const limit = sub.answered ? video.viewerTimeoutMs : video.pendingTimeoutMs;
    return now() - sub.seenAt < limit;
  }

  /** המצלמה הדלוקה של משתתף, או null. */
  function camOf(token, pid) {
    const cam = current.get(camKey(token, pid));
    return cam !== undefined && camAlive(cam) ? cam : null;
  }

  function camsOf(token) {
    const list = [];
    for (const cam of cams.values()) if (cam.token === token && camAlive(cam)) list.push(cam);
    return list.sort((a, b) => a.startedAt - b.startedAt);
  }

  function isBlocked(token, pid) {
    const until = blocks.get(token)?.get(pid);
    return until !== undefined && until > now();
  }

  function block(token, pid) {
    let map = blocks.get(token);
    if (map === undefined) {
      map = new Map();
      blocks.set(token, map);
    }
    map.set(pid, now() + cfg.blockMs);
  }

  function take(key, rate, burst) {
    const at = now();
    const bucket = buckets.get(key) ?? { tokens: burst, at };
    bucket.tokens = Math.min(burst, bucket.tokens + ((at - bucket.at) / 1000) * rate);
    bucket.at = at;
    buckets.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** כמה צופים (דפים) מחזיקים צפייה בבמה, חוץ מ-`except`: דף שמתחבר מחדש נספר פעם אחת. */
  function stageViewersOf(token, except) {
    const vids = new Set();
    for (const sub of subs.values()) {
      if (sub.token === token && !sub.host && sub.vid !== except && subAlive(sub))
        vids.add(sub.vid);
    }
    return vids.size;
  }

  function dropSub(sub) {
    if (subs.get(sub.handle) !== sub) return;
    subs.delete(sub.handle);
    closeTracks(
      sub.session,
      sub.tracks.map((t) => t.mid),
    );
  }

  /** רצועות שנחתכות מצפייה קיימת: Cloudflare מפסיק להעביר, והצופה יתחבר מחדש. */
  function cutTracks(sub, shouldCut) {
    const cut = sub.tracks.filter(shouldCut);
    if (cut.length === 0) return;
    sub.tracks = sub.tracks.filter((t) => !cut.includes(t));
    sub.stale = true;
    closeTracks(
      sub.session,
      cut.map((t) => t.mid),
    );
  }

  /**
   * מי על הבמה בפועל: מי שהמנחה בחר ושהמצלמה שלו דלוקה, בסדר שהמנחה בחר.
   * כשמשהו השתנה (גם מצלמה שהתחלפה) — גרסה חדשה, ומי שירד נחתך אצל הצופים.
   */
  function refresh(stage) {
    const ids = [];
    const sessions = [];
    for (const pid of stage.wanted) {
      const cam = camOf(stage.token, pid);
      if (cam === null) continue;
      ids.push(pid);
      sessions.push(cam.session);
    }
    const same =
      ids.length === stage.ids.length &&
      ids.every((pid, i) => pid === stage.ids[i] && sessions[i] === stage.sessions[i]);
    if (same) return;
    const onStage = new Set(sessions);
    for (const sub of subs.values()) {
      if (sub.token === stage.token && !sub.host) cutTracks(sub, (t) => !onStage.has(t.from));
    }
    stage.ids = ids;
    stage.sessions = sessions;
    seq += 1;
    stage.v = seq;
  }

  function endCam(cam, reason) {
    if (cams.get(cam.handle) !== cam) return;
    cams.delete(cam.handle);
    const key = camKey(cam.token, cam.pid);
    if (current.get(key) === cam) current.delete(key);
    ended.set(cam.handle, { reason, at: now() });
    closeTracks(cam.session, [cam.mid]);
    for (const sub of subs.values()) {
      if (sub.token === cam.token) cutTracks(sub, (t) => t.from === cam.session);
    }
    const stage = stages.get(cam.token);
    if (stage !== undefined) refresh(stage);
    log(`cam off ${cam.token.slice(0, 6)} ${cam.pid.slice(0, 6)} (${reason})`);
  }

  /** סגירת הבמה: כל המצלמות נכבות וכל הצפיות נסגרות. */
  function closeStage(token, reason) {
    const stage = stages.get(token);
    stages.delete(token);
    for (const cam of [...cams.values()]) if (cam.token === token) endCam(cam, reason);
    for (const sub of [...subs.values()]) if (sub.token === token) dropSub(sub);
    buckets.delete(`${token}:cam`);
    buckets.delete(`${token}:sub`);
    if (stage !== undefined) log(`stage close ${token.slice(0, 6)} (${reason})`);
  }

  function stageReply(stage) {
    return {
      ok: true,
      open: true,
      v: stage.v,
      ids: stage.ids,
      // ‏at: מצלמה שהתחלפה (המשתתף התחבר מחדש) — התצוגה המקדימה של המנחה מתחברת אליה מחדש.
      cams: camsOf(stage.token).map((cam) => ({ id: cam.pid, name: cam.name, at: cam.startedAt })),
      maxOnStage: cfg.maxOnStage,
      maxCams: cfg.maxCams,
      maxPreview: cfg.maxPreview,
    };
  }

  const CLOSED_REPLY = {
    ok: true,
    open: false,
    v: 0,
    ids: [],
    cams: [],
    maxOnStage: cfg.maxOnStage,
    maxCams: cfg.maxCams,
    maxPreview: cfg.maxPreview,
  };

  // ------------------------------------------------------------- המנחה

  async function handleStage(token, req, body) {
    const check = await checkHost(req, token, body);
    if (check.status !== 200) return [check.status, { error: check.error }];
    if (check.ent.stage !== true) return [403, { error: 'not-entitled' }];
    // שני מסכים ראשיים: רק מי שמחזיק את השידור עכשיו קובע.
    const pub = livePub(token);
    if (pub !== null && pub.gen !== body.gen) return [409, { error: 'superseded' }];

    let stage = stages.get(token);
    if (body.open !== true) {
      if (stage !== undefined) closeStage(token, 'closed');
      return [200, CLOSED_REPLY];
    }
    if (stage === undefined) {
      // פותחים רק כשהמנחה משדר; במה פתוחה ממשיכה גם כשהשידור מתחבר מחדש.
      if (pub === null) return [409, { error: 'no-video' }];
      seq += 1;
      stage = {
        token,
        gameId: check.gameId,
        cap: check.ent.cap,
        wanted: [],
        ids: [],
        sessions: [],
        v: seq,
        hostSeenAt: now(),
      };
      stages.set(token, stage);
      log(`stage open ${token.slice(0, 6)}`);
    }
    stage.hostSeenAt = now();
    stage.cap = check.ent.cap;

    // המנחה כיבה מצלמה: נכבית, והמשתתף לא מדליק שוב עד שעובר הזמן.
    for (const pid of idList(body.off, cfg.maxCams)) {
      block(token, pid);
      const cam = current.get(camKey(token, pid));
      if (cam !== undefined) endCam(cam, 'blocked');
    }
    if (Array.isArray(body.ids)) {
      stage.wanted = idList(body.ids, cfg.maxOnStage).filter((pid) => !isBlocked(token, pid));
    }
    refresh(stage);
    return [200, stageReply(stage)];
  }

  // ------------------------------------------------------------- המשתתף

  /** הבמה פתוחה, המזהה תקין, והמשתתף לא חסום. */
  function camGate(token, body) {
    if (!configured) return { status: 503, error: 'not-configured' };
    const stage = stages.get(token);
    if (stage === undefined) return { status: 409, error: 'closed' };
    const cid = typeof body.cid === 'string' ? body.cid : '';
    if (!CID_RE.test(cid)) return { status: 400, error: 'bad-message' };
    const pid = pidFor(token, cid);
    if (isBlocked(token, pid)) return { status: 403, error: 'blocked' };
    return { status: 200, stage, pid };
  }

  async function handleCamConfig(token, body) {
    const gate = camGate(token, body);
    if (gate.status !== 200) return [gate.status, { error: gate.error }];
    if (!take(`${token}:cam`, cfg.camPerSecond, cfg.camBurst)) {
      return [429, { error: 'slow-down' }];
    }
    return [200, { ok: true, id: gate.pid, iceServers: await iceServers() }];
  }

  async function handleCam(token, body) {
    const gate = camGate(token, body);
    if (gate.status !== 200) return [gate.status, { error: gate.error }];
    const name = cleanName(body.name, cfg.nameMax);
    const { sdp } = body;
    const mid = String(body.mid ?? '');
    const simulcast = Array.isArray(body.simulcast) ? body.simulcast : [];
    if (
      name === '' ||
      typeof sdp !== 'string' ||
      sdp.length === 0 ||
      sdp.length > video.maxSdpBytes ||
      !MID_RE.test(mid) ||
      simulcast.length > 3 ||
      !simulcast.every((rid) => typeof rid === 'string' && RID_RE.test(rid))
    ) {
      return [400, { error: 'bad-message' }];
    }
    const key = camKey(token, gate.pid);
    if (!current.has(key)) {
      if (camsOf(token).length >= cfg.maxCams) return [429, { error: 'full' }];
      if (cams.size >= cfg.maxCamsTotal) return [503, { error: 'busy' }];
    }
    if (!take(`${token}:cam`, cfg.camPerSecond, cfg.camBurst)) {
      return [429, { error: 'slow-down' }];
    }

    let session;
    let reply;
    try {
      session = await newSession();
      reply = await cf('POST', `/sessions/${session}/tracks/new`, {
        sessionDescription: { type: 'offer', sdp },
        tracks: [{ location: 'local', mid, trackName: TRACK }],
      });
    } catch (err) {
      log(`cam ${token.slice(0, 6)} failed: ${err?.message ?? err}`);
      return [502, { error: 'sfu-error' }];
    }
    const error = cfError(reply, true);
    const answer = reply.json?.sessionDescription;
    if (error !== null || answer?.type !== 'answer' || typeof answer.sdp !== 'string') {
      log(`cam ${token.slice(0, 6)} tracks/new: ${error ?? 'no answer'}`);
      closeTracks(session, [mid]);
      return [502, { error: 'sfu-error' }];
    }
    // אחרי ה-await: הבמה עוד פתוחה, והמנחה לא כיבה את המשתתף בינתיים?
    if (stages.get(token) !== gate.stage) {
      closeTracks(session, [mid]);
      return [409, { error: 'closed' }];
    }
    if (isBlocked(token, gate.pid)) {
      closeTracks(session, [mid]);
      return [403, { error: 'blocked' }];
    }

    const cam = {
      handle: newId(),
      token,
      pid: gate.pid,
      name,
      session,
      mid,
      simulcast,
      beatAt: now(),
      startedAt: now(),
    };
    const previous = current.get(key);
    cams.set(cam.handle, cam);
    current.set(key, cam);
    // אותו משתתף שהתחבר שוב: המצלמה הקודמת נכבית, והוא נשאר על הבמה.
    if (previous !== undefined) endCam(previous, 'replaced');
    else refresh(gate.stage);
    log(
      `cam on ${token.slice(0, 6)} ${cam.pid.slice(0, 6)}${simulcast.length > 1 ? ' simulcast' : ''}`,
    );
    return [
      200,
      {
        ok: true,
        handle: cam.handle,
        id: cam.pid,
        sdp: answer.sdp,
        onStage: gate.stage.ids.includes(cam.pid),
      },
    ];
  }

  function camFor(token, body) {
    const handle = typeof body.handle === 'string' ? body.handle : '';
    if (!HANDLE_RE.test(handle)) return { handle: '', cam: null };
    const cam = cams.get(handle);
    return { handle, cam: cam !== undefined && cam.token === token ? cam : null };
  }

  function handleCamBeat(token, body) {
    const { handle, cam } = camFor(token, body);
    if (cam === null || !camAlive(cam)) {
      if (cam !== null) endCam(cam, 'timeout');
      // הסיבה (המנחה כיבה, הבמה נסגרה…) — רק למי שמחזיק את המזהה של המצלמה.
      return [404, { error: ended.get(handle)?.reason ?? 'gone' }];
    }
    cam.beatAt = now();
    return [200, { ok: true, onStage: stages.get(token)?.ids.includes(cam.pid) === true }];
  }

  function handleCamStop(token, body) {
    const { cam } = camFor(token, body);
    if (cam !== null) endCam(cam, 'stopped');
    return [200, { ok: true }];
  }

  // ------------------------------------------------------------- הצופים

  async function handleStageSub(token, req, body) {
    if (!configured) return [503, { error: 'not-configured' }];
    const stage = stages.get(token);
    if (stage === undefined) return [409, { error: 'closed' }];
    const host = isHost(req, token);
    const vid = typeof body.vid === 'string' ? body.vid.slice(0, 64) : '';
    const ids = idList(body.ids, host ? cfg.maxPreview : cfg.maxOnStage);
    if (vid === '' || ids.length === 0) return [400, { error: 'bad-message' }];
    const high = body.layer === 'high';
    // צופה: רק מי שעל הבמה עכשיו. המסך הראשי: כל מצלמה דלוקה (תצוגה מקדימה).
    if (!host && ids.some((pid) => !stage.ids.includes(pid))) return [409, { error: 'stale' }];
    const chosen = ids.map((pid) => camOf(token, pid)).filter((cam) => cam !== null);
    if (chosen.length === 0) return [409, { error: 'stale' }];

    // אותו דף שמתחבר שוב (הבמה השתנתה): הצפייה הקודמת שלו נשארת עד שהחדשה
    // מנגנת, כדי שלא יהיה מסך שחור באמצע — אבל לא יותר משתיים.
    const own = [...subs.values()]
      .filter((s) => s.token === token && s.vid === vid)
      .sort((a, b) => a.createdAt - b.createdAt);
    while (own.length >= 2) dropSub(own.shift());
    if (host) {
      const hosts = [...subs.values()]
        .filter((s) => s.token === token && s.host)
        .sort((a, b) => a.createdAt - b.createdAt);
      while (hosts.length >= cfg.maxHostSubs) dropSub(hosts.shift());
    } else {
      // אותה תקרה כמו בווידאו המנחה: צופים, לא חיבורים.
      if (stageViewersOf(token, vid) >= stage.cap) return [429, { error: 'full' }];
      // כל הצופים מתחברים מחדש כשהבמה משתנה, ולכן הפרץ בגודל התקרה.
      const rate = Math.max(10, Math.ceil(stage.cap / 10));
      if (!take(`${token}:sub`, rate, Math.max(40, stage.cap)))
        return [429, { error: 'slow-down' }];
    }
    if (subs.size >= video.maxViewers * 2) return [503, { error: 'busy' }];
    const ice = iceServers(); // במקביל לפתיחת החיבור ב-Cloudflare

    const remote = chosen.map((cam) => ({
      location: 'remote',
      sessionId: cam.session,
      trackName: TRACK,
      ...(cam.simulcast.length > 1
        ? {
            simulcast: {
              preferredRid: layerRid(cam.simulcast, high),
              priorityOrdering: 'asciibetical',
              ridNotAvailable: 'asciibetical',
            },
          }
        : {}),
    }));
    let session;
    let reply;
    try {
      session = await newSession();
      reply = await cf('POST', `/sessions/${session}/tracks/new`, { tracks: remote });
    } catch (err) {
      log(`stage-sub ${token.slice(0, 6)} failed: ${err?.message ?? err}`);
      return [502, { error: 'sfu-error' }];
    }
    const offer = reply.json?.sessionDescription;
    const got = Array.isArray(reply.json?.tracks) ? reply.json.tracks : [];
    // רצועה שנכשלה (מצלמה שנכבתה בדיוק עכשיו) לא מפילה את השאר.
    const tracks = [];
    got.forEach((t, i) => {
      const mid = String(t?.mid ?? '');
      const cam =
        chosen.find((c) => typeof t?.sessionId === 'string' && c.session === t.sessionId) ??
        chosen[i];
      if (mid === '' || t?.errorCode || cam === undefined) return;
      tracks.push({ mid, pid: cam.pid, from: cam.session });
    });
    const error = cfError(reply, false);
    if (error !== null || offer?.type !== 'offer' || typeof offer.sdp !== 'string') {
      log(`stage-sub ${token.slice(0, 6)} tracks/new: ${error ?? 'no offer'}`);
      closeTracks(
        session,
        tracks.map((t) => t.mid),
      );
      return [502, { error: 'sfu-error' }];
    }
    // אחרי ה-await: אותה במה, וכל מה שביקשנו עדיין דלוק (ועל הבמה, לצופה)?
    const valid =
      tracks.length > 0 &&
      stages.get(token) === stage &&
      tracks.every(
        (t) => camOf(token, t.pid)?.session === t.from && (host || stage.sessions.includes(t.from)),
      );
    if (!valid) {
      closeTracks(
        session,
        tracks.map((t) => t.mid),
      );
      return [409, { error: stages.get(token) === stage ? 'stale' : 'closed' }];
    }
    const sub = {
      handle: newId(),
      token,
      vid,
      host,
      session,
      tracks,
      answered: false,
      stale: false,
      seenAt: now(),
      createdAt: now(),
    };
    subs.set(sub.handle, sub);
    return [
      200,
      {
        ok: true,
        handle: sub.handle,
        v: stage.v,
        sdp: offer.sdp,
        tracks: tracks.map((t) => ({ mid: t.mid, id: t.pid })),
        iceServers: await ice,
      },
    ];
  }

  function subFor(token, body) {
    const handle = typeof body.handle === 'string' ? body.handle : '';
    if (!HANDLE_RE.test(handle)) return null;
    const sub = subs.get(handle);
    return sub !== undefined && sub.token === token ? sub : null;
  }

  async function handleStageAnswer(token, body) {
    const sub = subFor(token, body);
    if (sub === null || !subAlive(sub)) return [404, { error: 'gone' }];
    if (sub.answered) return [409, { error: 'answered' }];
    if (
      typeof body.sdp !== 'string' ||
      body.sdp.length === 0 ||
      body.sdp.length > video.maxSdpBytes
    ) {
      return [400, { error: 'bad-message' }];
    }
    sub.answered = true; // תשובה אחת בלבד, גם אם השנייה מגיעה לפני שהראשונה חזרה
    let reply;
    try {
      reply = await cf('PUT', `/sessions/${sub.session}/renegotiate`, {
        sessionDescription: { type: 'answer', sdp: body.sdp },
      });
    } catch (err) {
      log(`stage-answer ${token.slice(0, 6)} failed: ${err?.message ?? err}`);
      dropSub(sub);
      return [502, { error: 'sfu-error' }];
    }
    const error = cfError(reply, false);
    if (error !== null) {
      log(`stage-answer ${token.slice(0, 6)} renegotiate: ${error}`);
      dropSub(sub);
      return [502, { error: 'sfu-error' }];
    }
    sub.seenAt = now();
    return [200, { ok: true }];
  }

  function handleStagePing(token, body) {
    const sub = subFor(token, body);
    const stage = stages.get(token);
    if (sub === null || !subAlive(sub) || stage === undefined) {
      if (sub !== null) dropSub(sub);
      return [404, { error: 'gone' }];
    }
    sub.seenAt = now();
    return [200, { ok: true, v: stage.v, stale: sub.stale }];
  }

  function handleStageLeave(token, body) {
    const sub = subFor(token, body);
    if (sub !== null) dropSub(sub);
    return [200, { ok: true }];
  }

  // ------------------------------------------------------------- ממשק

  /** בקשה ל-‎/live/<W>/video/<action>‎ של הבמה. */
  function handle(req, token, action, body) {
    switch (action) {
      case 'stage':
        return handleStage(token, req, body);
      case 'cam-config':
        return handleCamConfig(token, body);
      case 'cam':
        return handleCam(token, body);
      case 'cam-beat':
        return handleCamBeat(token, body);
      case 'cam-stop':
        return handleCamStop(token, body);
      case 'stage-sub':
        return handleStageSub(token, req, body);
      case 'stage-answer':
        return handleStageAnswer(token, body);
      case 'stage-ping':
        return handleStagePing(token, body);
      case 'stage-leave':
        return handleStageLeave(token, body);
      default:
        return [404, { error: 'not-found' }];
    }
  }

  /** ניקוי: מצלמות וצפיות ששתקו, במות שהמנחה שלהן נעלם, זיכרונות ישנים. */
  function tick() {
    const at = now();
    for (const cam of [...cams.values()]) if (!camAlive(cam)) endCam(cam, 'timeout');
    for (const sub of [...subs.values()]) if (!subAlive(sub)) dropSub(sub);
    for (const [token, stage] of [...stages]) {
      if (at - stage.hostSeenAt > cfg.hostTimeoutMs) closeStage(token, 'timeout');
    }
    for (const [handle, entry] of ended)
      if (at - entry.at > cfg.endedMemoryMs) ended.delete(handle);
    for (const [token, map] of blocks) {
      for (const [pid, until] of map) if (until <= at) map.delete(pid);
      if (map.size === 0) blocks.delete(token);
    }
    for (const [key, bucket] of buckets) if (at - bucket.at > 60_000) buckets.delete(key);
  }

  function stats() {
    return { stages: stages.size, cams: cams.size, stageViewers: subs.size };
  }

  return { handle, closeStage, tick, stats, config: cfg, stages, cams, subs };
}
