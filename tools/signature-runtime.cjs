#!/usr/bin/env node
// @ts-check
/**
 * בדיקה שחתימת קובצי המשחק (electron/gameSignature.cjs) עובדת בזמן הריצה של
 * Electron עצמו, ולא רק ב-Node שמריץ את הבדיקות: Electron בנוי על BoringSSL ולא
 * על OpenSSL. בלי Ed25519 שם כל בדיקה הייתה נגמרת ב"תקלה", שלעולם אינה נועלת,
 * והחתימה הייתה מפסיקה להגן בלי שאיש ירגיש.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron tools/signature-runtime.cjs
 *
 * build-desktop.yml מריץ אותה על Windows לפני הבנייה. הווקטור הוא זה של
 * tests/gameSignature.test.ts (והמערכת), במפתח של RFC 8032 — לעולם לא מפתח אמיתי.
 * קוד יציאה 1 בכל כישלון.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const sig = require(path.join(__dirname, '..', 'electron', 'gameSignature.cjs'));

const RFC_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const TEST_X = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo';
const KID = '21fe31dfa154a261';
const KEYS = { [KID]: TEST_X };
const VECTOR_GAME = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'משחק בדיקה "חתימה" ✓ 🎯',
  setting: { limit: { type: 'clickers', number: 20 }, mainColor: '#00000070', b: [3, 1.5, -0, 1e21, 0.1, null, true, '\u2028'], a: {}, A: [], _: 'x\\y', 10: 1, 2: 2 },
  questions: [{ question: { que: 'שאלה?', answers: [{ ans: 'א', correct: true, id: 1 }] }, id: 1, lone: '\ud800' }],
  users: '{"5":{"name":"דנה"}}',
  pendingUsers: [{ id: 'p', name: 'רון', groupName: '' }],
  room: 2047,
  credit: 'lic',
  metadata: { generatedAt: '2026-10-11T00:00:00.000Z', isOffline: true, offlineVersion: '2.0' },
};
const VECTOR_CONTENT = '539c036b3f3466ce52bc8b7ad959fe8e8b7cb4c7fc81b72b4d7727c09c0afddf';
const VECTOR_PAYLOAD =
  '{"admin":false,"content":"539c036b3f3466ce52bc8b7ad959fe8e8b7cb4c7fc81b72b4d7727c09c0afddf","game":"00000000-0000-4000-8000-000000000001","seal":{"clickers":true,"limit":20,"phones":true,"room":"2047"},"v":1}';
const VECTOR_SIG = 'PfWvZItAf7ey+XrrVH9/ZcELr05B0zXc9KLV7laFAbrTkH5Db4CQ2lbe9xnbNMDaUyN49oFx3TH1PivJrYOJDw==';
const signed = () => JSON.parse(JSON.stringify({ ...VECTOR_GAME, signature: { v: 1, kid: KID, payload: VECTOR_PAYLOAD, sig: VECTOR_SIG } }, null, 2));

let failed = 0;
/** @param {string} name @param {() => unknown} fn @param {unknown} want */
function check(name, fn, want) {
  /** @type {unknown} */
  let got;
  try {
    got = fn();
  } catch (err) {
    got = `threw: ${/** @type {Error} */ (err).message}`;
  }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

const runtime = process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.versions.node}`;
// ב-Electron process.versions.openssl הוא 0.0.0: הספרייה שם היא BoringSSL.
const tls = process.versions.electron ? 'BoringSSL' : `OpenSSL ${process.versions.openssl}`;
console.log(`[signature-runtime] ${runtime}, ${process.platform}, ${tls}`);

check('kid של המפתח', () => sig.keyIdFor(TEST_X), KID);
check('hash של משחק הווקטור', () => sig.contentHash(signed()), VECTOR_CONTENT);
check('הווקטור של המערכת תקין', () => sig.checkGame(signed(), KEYS).state, 'valid');
check('מגבלה שהועלתה — שונה', () => {
  const g = signed();
  g.setting.limit.number = 500;
  return [sig.checkGame(g, KEYS).state, /** @type {{ reason?: string }} */ (sig.checkGame(g, KEYS)).reason];
}, ['invalid', 'content']);
check('חתימה מזויפת — שונה', () => {
  const g = signed();
  g.signature.sig = `${'A'.repeat(86)}==`;
  return /** @type {{ reason?: string }} */ (sig.checkGame(g, KEYS)).reason;
}, 'signature');
check('חתימה חדשה בזמן הריצה הזה', () => {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(RFC_SEED, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
  const g = { ...VECTOR_GAME, name: 'נחתם עכשיו' };
  const payload = sig.canonicalJson({ v: 1, game: g.id, content: sig.contentHash(g), seal: null, admin: true });
  const s = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
  return sig.checkGame({ ...g, signature: { v: 1, kid: KID, payload, sig: s } }, KEYS).state;
}, 'valid');
check('כל מפתח מוטבע נטען', () => Object.entries(sig.PUBLIC_KEYS).map(([kid, x]) => {
  const g = signed();
  g.signature.kid = kid;
  return [sig.keyIdFor(x) === kid, sig.checkGame(g).state];
}), Object.keys(sig.PUBLIC_KEYS).map(() => [true, 'invalid']));

console.log(failed === 0 ? '[signature-runtime] הכול עבר' : `[signature-runtime] ${failed} נכשלו`);
process.exit(failed === 0 ? 0 : 1);
