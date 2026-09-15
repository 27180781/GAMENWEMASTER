// @ts-check
/**
 * הורדת קובץ אחד לדיסק דרך `net` של Electron — עם המשך מהנקודה שבה נעצרנו.
 *
 * הקובץ נכתב ל-`<dest>.part`. אם כבר קיים חלק כזה מניסיון קודם, הבקשה יוצאת
 * עם Range מהגודל שכבר בדיסק, והשרת (Cloudflare R2, כמו כל שרת קבצים סטטי)
 * עונה 206 עם ההמשך בלבד. שרת שעונה 200 במקום — מתחילים את הקובץ מחדש.
 * בסיום הגודל מושווה למה שהשרת הכריז; קובץ קצר מדי נשאר כחלק להמשך ולא
 * מוכרז כשלם.
 *
 * `net` מוזרק כדי שהמודול לא ייגע ב-Electron בטעינה; ההסתעפויות שאינן רשת
 * (תכנון ההורדה, האריזה) נבדקות ב-tests/remoteGame.test.ts.
 */
const fs = require('node:fs');
const { remoteErrorMessage, isRetryable } = require('./remoteErrors.cjs');

/** פסק-זמן על *שקט* בקו, ותקרה לקובץ בודד. */
const IDLE_MS = 45 * 1000;
const CEILING_MS = 30 * 60 * 1000;

/**
 * @typedef {{ ok: true, bytes: number } | { ok: false, error: string, retryable: boolean, status?: number }} FileResult
 */

/**
 * @param {import('electron').IncomingMessage} res
 * @param {string} name
 */
function header(res, name) {
  const v = /** @type {Record<string, string | string[] | undefined>} */ (res.headers)[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * @param {typeof import('electron').net} net
 * @param {string} url
 * @param {string} dest נתיב היעד הסופי (החלק נכתב ל-`dest.part`)
 * @param {{ onProgress?: (p: { received: number, total: number }) => void, headers?: Record<string, string>, idleMs?: number, ceilingMs?: number }} [opts]
 * @returns {Promise<FileResult>}
 */
function downloadToFile(net, url, dest, opts = {}) {
  const { onProgress = () => {}, headers = {}, idleMs = IDLE_MS, ceilingMs = CEILING_MS } = opts;
  return new Promise((resolve) => {
    const part = `${dest}.part`;
    let start = 0;
    try {
      start = fs.statSync(part).size;
    } catch {
      start = 0;
    }
    let settled = false;
    /** @type {NodeJS.Timeout | null} */
    let idle = null;
    /** @type {import('node:fs').WriteStream | null} */
    let out = null;
    /** @type {import('electron').ClientRequest | null} */
    let req = null;
    let written = start;
    let total = 0;

    /** @param {FileResult} result */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (idle !== null) clearTimeout(idle);
      clearTimeout(ceiling);
      try {
        req?.abort();
      } catch {
        /* כבר נסגר */
      }
      if (out !== null) {
        out.destroy(); // החלק נשאר בדיסק — ההמשך הבא יתחיל ממה שנכתב
        out = null;
      }
      resolve(result);
    };
    const ceiling = setTimeout(() => finish({ ok: false, error: 'ההורדה ארכה יותר מדי', retryable: true }), ceilingMs);
    const touch = () => {
      if (idle !== null) clearTimeout(idle);
      idle = setTimeout(() => finish({ ok: false, error: 'ההורדה נתקעה — בדקו את החיבור לאינטרנט', retryable: true }), idleMs);
    };

    try {
      req = net.request({ method: 'GET', url });
    } catch (err) {
      finish({ ok: false, error: /** @type {Error} */ (err).message, retryable: false });
      return;
    }
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    if (start > 0) req.setHeader('Range', `bytes=${start}-`);
    touch();
    req.on('error', (err) => finish({ ok: false, error: `החיבור נכשל: ${err.message}`, retryable: true }));
    req.on('response', (res) => {
      const status = res.statusCode;
      let append = false;
      if (status === 206 && start > 0) {
        append = true;
        const m = /\/(\d+)\s*$/.exec(header(res, 'content-range') ?? '');
        total = m ? Number(m[1]) : 0;
      } else if (status === 200) {
        // הכול מההתחלה — גם אם ביקשנו המשך (שרת בלי תמיכה בטווחים).
        start = 0;
        written = 0;
        total = Number(header(res, 'content-length')) || 0;
      } else if (status === 416) {
        // הטווח מעבר לסוף הקובץ: החלק שבדיסק אינו תואם למה שבשרת — מתחילים מחדש.
        res.resume?.();
        try {
          fs.rmSync(part, { force: true });
        } catch {
          /* אין חלק */
        }
        finish({ ok: false, error: 'החלק השמור אינו תואם לשרת — הקובץ יורד מחדש', retryable: true, status });
        return;
      } else {
        res.resume?.();
        finish({ ok: false, error: remoteErrorMessage(status), retryable: isRetryable(status), status });
        return;
      }
      try {
        out = fs.createWriteStream(part, { flags: append ? 'a' : 'w' });
      } catch (err) {
        finish({ ok: false, error: /** @type {Error} */ (err).message, retryable: false });
        return;
      }
      out.on('error', (err) => finish({ ok: false, error: `כתיבה לדיסק נכשלה: ${err.message}`, retryable: false }));
      touch();
      res.on('data', (chunk) => {
        written += chunk.length;
        out?.write(chunk);
        touch();
        onProgress({ received: written, total });
      });
      res.on('error', (err) => finish({ ok: false, error: err.message, retryable: true }));
      res.on('end', () => {
        if (settled || out === null) return;
        const stream = out;
        out = null; // מכאן החלק הוא הקובץ — אין להשמיד אותו ב-finish
        stream.end(() => {
          if (total > 0 && written !== total) {
            // הקו נסגר לפני הסוף (ה-end מגיע גם על ניתוק) — החלק נשאר להמשך.
            finish({ ok: false, error: `הקובץ הגיע חלקית (${written} מתוך ${total} בתים)`, retryable: true });
            return;
          }
          try {
            fs.rmSync(dest, { force: true });
            fs.renameSync(part, dest);
          } catch (err) {
            finish({ ok: false, error: /** @type {Error} */ (err).message, retryable: false });
            return;
          }
          finish({ ok: true, bytes: written });
        });
      });
    });
    req.end();
  });
}

module.exports = { downloadToFile, IDLE_MS, CEILING_MS };

/**
 * הורדת **טווח** אחד של קובץ (Range: bytes=start–end−1) אל sink — לבנייה
 * הפרשית של מתקין (updateDownload.cjs). כל chunk נמסר ל-`sink` ורק אחר כך
 * נספר; השרת חייב לענות 206 בדיוק על הטווח שביקשנו (200 = כל הקובץ — לא
 * מה שביקשנו, אלא כשביקשנו מאפס).
 *
 * @param {typeof import('electron').net} net
 * @param {string} url
 * @param {number} start
 * @param {number} end לא כולל
 * @param {(chunk: Buffer) => void} sink
 * @param {{ idleMs?: number, ceilingMs?: number, headers?: Record<string, string> }} [opts]
 * @returns {Promise<FileResult>}
 */
function downloadRange(net, url, start, end, sink, opts = {}) {
  const { idleMs = IDLE_MS, ceilingMs = CEILING_MS, headers = {} } = opts;
  const expected = end - start;
  return new Promise((resolve) => {
    let settled = false;
    /** @type {NodeJS.Timeout | null} */
    let idle = null;
    /** @type {import('electron').ClientRequest | null} */
    let req = null;
    let received = 0;
    /** @param {FileResult} result */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (idle !== null) clearTimeout(idle);
      clearTimeout(ceiling);
      try {
        req?.abort();
      } catch {
        /* נסגר */
      }
      resolve(result);
    };
    const ceiling = setTimeout(() => finish({ ok: false, error: 'ההורדה ארכה יותר מדי', retryable: true }), ceilingMs);
    const touch = () => {
      if (idle !== null) clearTimeout(idle);
      idle = setTimeout(() => finish({ ok: false, error: 'ההורדה נתקעה — בדקו את החיבור לאינטרנט', retryable: true }), idleMs);
    };
    try {
      req = net.request({ method: 'GET', url });
    } catch (err) {
      finish({ ok: false, error: /** @type {Error} */ (err).message, retryable: false });
      return;
    }
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    req.setHeader('Range', `bytes=${start}-${end - 1}`);
    touch();
    req.on('error', (err) => finish({ ok: false, error: `החיבור נכשל: ${err.message}`, retryable: true }));
    req.on('response', (res) => {
      const status = res.statusCode;
      const wholeFile = status === 200 && start === 0;
      if (status !== 206 && !wholeFile) {
        res.resume?.();
        finish({
          ok: false,
          error: status === 200 ? 'השרת אינו תומך בהורדת טווחים' : remoteErrorMessage(status),
          retryable: status !== 200 && isRetryable(status),
          status,
        });
        return;
      }
      touch();
      res.on('data', (chunk) => {
        if (settled) return;
        // לא יותר ממה שביקשנו — שרת שמחזיר את כל הקובץ על 200 נעצר בגבול הטווח.
        const take = Math.min(chunk.length, expected - received);
        if (take > 0) {
          try {
            sink(take === chunk.length ? chunk : chunk.subarray(0, take));
          } catch (err) {
            finish({ ok: false, error: `כתיבה לדיסק נכשלה: ${/** @type {Error} */ (err).message}`, retryable: false });
            return;
          }
          received += take;
        }
        touch();
        if (received >= expected) finish({ ok: true, bytes: received });
      });
      res.on('error', (err) => finish({ ok: false, error: err.message, retryable: true }));
      res.on('end', () => {
        if (received >= expected) finish({ ok: true, bytes: received });
        else finish({ ok: false, error: `הטווח הגיע חלקית (${received} מתוך ${expected} בתים)`, retryable: true });
      });
    });
    req.end();
  });
}

module.exports.downloadRange = downloadRange;
