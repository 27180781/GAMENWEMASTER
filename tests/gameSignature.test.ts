/**
 * חתימת השרת על קובצי המשחק (electron/gameSignature.cjs). הווקטורים כאן זהים
 * לאלה שבמערכת (scripts/test-edge-shared.mjs ב-project-bc6b28de…): אותו משחק,
 * אותו hash, אותו payload ואותה חתימה. אם אחד מהם משתנה, כל תוכנה שבשטח מפסיקה
 * לקבל חבילות חדשות — משנים את שני הצדדים יחד, עם גרסת חתימה חדשה.
 *
 * המפתח הוא של RFC 8032 §7.1 (בדיקה 1), לעולם לא מפתח אמיתי.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createPrivateKey, sign as edSign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
type Keys = Readonly<Record<string, string>>;
type Payload = { v: unknown; game: unknown; content: unknown; seal: unknown; admin: unknown };
type Check =
  | { state: 'valid'; kid: string; payload: Payload }
  | { state: 'invalid'; reason: string }
  | { state: 'unsigned'; reason: string }
  | { state: 'error'; reason: string };
type GameCheck = Check & { content: string | null; sidecar?: boolean };
type SealTerms = { clickers: boolean; phones: boolean; room: string | null; limit: number | null };
type SignRequest = { gameId: string; license: string; content: string };
type SignResult = { gameId: string; content: string; signature: unknown } | { gameId: string; content: string; reason: string };
type Signature = { v: number; kid: string; payload: string; sig: string };
const lib = require('../electron/gameLibrary.cjs') as { readPackageText: (zipPath: string) => string | null };
const { writeStoreZip } = require('../electron/zipStore.cjs') as {
  writeStoreZip: (out: string, entries: { path: string; data?: Buffer | string }[]) => Promise<number>;
};
const sig = require('../electron/gameSignature.cjs') as {
  SIGNATURE_VERSION: number;
  UNSIGNED_KEYS: readonly string[];
  PUBLIC_KEYS: Keys;
  REFUSAL_RETRY_MS: number;
  MAX_SIGN: number;
  canonicalJson: (value: unknown) => string;
  contentHash: (game: Record<string, unknown>) => string;
  keyIdFor: (publicKey: string) => string;
  verifySignature: (signature: unknown, gameId: string, content: string, keys: Keys) => Check;
  checkGame: (game: unknown, keys?: Keys) => GameCheck;
  checkStored: (game: unknown, opts?: { userData?: string | null; keys?: Keys }) => GameCheck;
  signaturePolicy: (
    check: { state: string },
    ctx: { requireSigned: boolean; approved: boolean; sealed: boolean },
  ) => { demoOnly: boolean; why: 'changed' | 'unsigned' | null };
  sealTermsOf: (check: { state: string; payload?: Payload }) => SealTerms | null;
  boundSealConfig: <T extends Record<string, unknown>>(config: T, terms: SealTerms | null) => T;
  signaturesDir: (userData: string) => string;
  readSidecar: (userData: string, content: string) => { signature?: unknown; refused?: string; at?: number } | null;
  surveyFiles: (opts: {
    userData: string;
    files: { path: string; local?: boolean; edited?: boolean }[];
    readText: (zipPath: string) => string | null;
    keys?: Keys;
    now?: number;
  }) => { unsigned: number; sign: SignRequest[] };
  applySignatures: (opts: {
    userData: string;
    requested: SignRequest[];
    results: SignResult[];
    keys?: Keys;
    now?: number;
  }) => { stored: number; refused: number };
};

// --- המפתח והווקטורים, כמו במערכת -----------------------------------------
const RFC_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const TEST_X = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo';
const KID = '21fe31dfa154a261';
const KEYS: Keys = { [KID]: TEST_X };
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(RFC_SEED, 'hex')]),
  format: 'der',
  type: 'pkcs8',
});

const VECTOR_GAME = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'משחק בדיקה "חתימה" ✓ 🎯',
  setting: { limit: { type: 'clickers', number: 20 }, mainColor: '#00000070', b: [3, 1.5, -0, 1e21, 0.1, null, true, ' '], a: {}, A: [], _: 'x\\y', 10: 1, 2: 2 },
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
const VECTOR_SIGNATURE: Signature = { v: 1, kid: KID, payload: VECTOR_PAYLOAD, sig: VECTOR_SIG };
const BOTH: SealTerms = { clickers: true, phones: true, room: '2047', limit: 20 };

/** חותם כמו signOfflinePackage במערכת. */
function signatureFor(game: Record<string, unknown>, over: Partial<Payload> = {}): Signature {
  const payload = sig.canonicalJson({
    v: 1,
    game: String(game.id ?? ''),
    content: sig.contentHash(game),
    seal: BOTH,
    admin: false,
    ...over,
  });
  return { v: 1, kid: KID, payload, sig: edSign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64') };
}

/** הקובץ כפי שהוא נקרא מהדיסק. */
const asRead = <T>(value: T): T => JSON.parse(JSON.stringify(value, null, 2));
const signed = () => asRead({ ...VECTOR_GAME, signature: VECTOR_SIGNATURE }) as typeof VECTOR_GAME & { signature: Signature };

const GAME_A = '11111111-1111-4111-8111-111111111111';
const GAME_B = '22222222-2222-4222-8222-222222222222';
const LICENSE = '33333333-3333-4333-8333-333333333333';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gamesig-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('הצורה הקנונית והווקטורים של המערכת', () => {
  it('ממיינת מפתחות בכל עומק ושומרת על סדר המערכים', () => {
    expect(sig.canonicalJson({ setting: VECTOR_GAME.setting, q: VECTOR_GAME.questions })).toBe(
      '{"q":[{"id":1,"lone":"\\ud800","question":{"answers":[{"ans":"א","correct":true,"id":1}],"que":"שאלה?"}}],' +
        '"setting":{"10":1,"2":2,"A":[],"_":"x\\\\y","a":{},"b":[3,1.5,0,1e+21,0.1,null,true," "],' +
        '"limit":{"number":20,"type":"clickers"},"mainColor":"#00000070"}}',
    );
    expect(sig.canonicalJson({ a: undefined, b: NaN, c: [undefined] })).toBe('{"b":null,"c":[null]}');
    expect(sig.canonicalJson(undefined)).toBe('null');
  });

  it('המפתח של RFC 8032 מקבל את ה-kid של המערכת', () => {
    expect(Buffer.from(TEST_X, 'base64url').toString('hex')).toBe('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
    expect(sig.keyIdFor(TEST_X)).toBe(KID);
  });

  it('משחק הווקטור מגיע לאותו hash, payload וחתימה כמו במערכת', () => {
    expect(sig.contentHash(VECTOR_GAME)).toBe(VECTOR_CONTENT);
    expect(signatureFor(VECTOR_GAME)).toEqual(VECTOR_SIGNATURE);
  });

  it('ה-hash מתעלם מהחתימה, מ-metadata, מהמשתתפים, מסדר המפתחות ומההזחה', () => {
    expect(sig.UNSIGNED_KEYS).toEqual(['signature', 'metadata', 'users', 'pendingUsers']);
    const reordered = asRead(Object.fromEntries(Object.entries(VECTOR_GAME).reverse())) as Record<string, unknown>;
    reordered.metadata = { version: 'abc' };
    reordered.users = '{}';
    reordered.pendingUsers = [];
    reordered.signature = { v: 1 };
    expect(sig.contentHash(reordered)).toBe(VECTOR_CONTENT);
  });
});

describe('checkGame', () => {
  it('חבילה חתומה תקינה גם אחרי שנכתבה מחדש, עם התנאים החתומים', () => {
    const r = sig.checkGame(signed(), KEYS);
    expect(r.state).toBe('valid');
    expect(r.content).toBe(VECTOR_CONTENT);
    expect(r.state === 'valid' && r.payload.seal).toEqual(BOTH);
  });

  it('מספרי שלטים שנקלטו ומשתתפים שנוספו אינם שוברים את החתימה', () => {
    const g = signed() as Record<string, unknown>;
    g.users = '{"5":{"name":"דנה","participantId":"p"},"7":{"name":"רון","pressed":true}}';
    g.pendingUsers = [];
    expect(sig.checkGame(g, KEYS).state).toBe('valid');
  });

  it('מגבלה שהועלתה, משחק אחר או חתימה ששונתה — "שונה"', () => {
    const raised = signed();
    raised.setting.limit.number = 500;
    expect(sig.checkGame(raised, KEYS)).toMatchObject({ state: 'invalid', reason: 'content' });

    const moved = signed();
    moved.id = '00000000-0000-4000-8000-000000000002';
    expect(sig.checkGame(moved, KEYS)).toMatchObject({ state: 'invalid', reason: 'game' });

    const forged = signed();
    forged.signature.payload = forged.signature.payload.replace('"limit":20', '"limit":500');
    expect(sig.checkGame(forged, KEYS)).toMatchObject({ state: 'invalid', reason: 'signature' });

    const swapped = signed();
    swapped.signature.sig = signatureFor({ ...VECTOR_GAME, name: 'אחר' }).sig;
    expect(sig.checkGame(swapped, KEYS)).toMatchObject({ state: 'invalid', reason: 'signature' });
  });

  it('בלי חתימה, חתימה שאי אפשר לקרוא או מפתח לא מוכר — "בלי חתימה"', () => {
    const withSig = (signature: unknown) => ({ ...VECTOR_GAME, signature });
    const s = VECTOR_SIGNATURE;
    expect(sig.checkGame(VECTOR_GAME, KEYS)).toMatchObject({ state: 'unsigned', reason: 'missing', content: VECTOR_CONTENT });
    expect(sig.checkGame(withSig(null), KEYS)).toMatchObject({ state: 'unsigned', reason: 'missing' });
    expect(sig.checkGame(withSig('x'), KEYS)).toMatchObject({ state: 'unsigned', reason: 'malformed' });
    expect(sig.checkGame(withSig({ ...s, sig: 5 }), KEYS)).toMatchObject({ state: 'unsigned', reason: 'malformed' });
    expect(sig.checkGame(withSig({ ...s, sig: 'AAAA' }), KEYS)).toMatchObject({ state: 'unsigned', reason: 'malformed' });
    expect(sig.checkGame(withSig({ ...s, sig: s.sig.slice(0, -2) }), KEYS)).toMatchObject({ state: 'unsigned', reason: 'malformed' });
    expect(sig.checkGame(withSig({ ...s, sig: ` ${s.sig}` }), KEYS)).toMatchObject({ state: 'unsigned', reason: 'malformed' });
    expect(sig.checkGame(withSig({ ...s, sig: `${s.sig.slice(0, 40)}\n${s.sig.slice(40)}` }), KEYS)).toMatchObject({
      state: 'unsigned',
      reason: 'malformed',
    });
    expect(sig.checkGame(withSig({ ...s, kid: '0000000000000000' }), KEYS)).toMatchObject({ state: 'unsigned', reason: 'unknown_key' });
    expect(sig.checkGame(withSig({ ...s, kid: 'constructor' }), KEYS)).toMatchObject({ state: 'unsigned', reason: 'unknown_key' });
    expect(sig.checkGame(withSig({ ...s, kid: '__proto__' }), KEYS)).toMatchObject({ state: 'unsigned', reason: 'unknown_key' });
    expect(sig.checkGame(withSig({ ...s, v: 2 }), KEYS)).toMatchObject({ state: 'unsigned', reason: 'version' });
  });

  it('payload שאינו אובייקט JSON — "בלי חתימה"; payload חתום מגרסה אחרת — "בלי חתימה"', () => {
    const text = (payload: string): Signature => ({
      v: 1,
      kid: KID,
      payload,
      sig: edSign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64'),
    });
    expect(sig.checkGame({ ...VECTOR_GAME, signature: text('not json') }, KEYS)).toMatchObject({ state: 'unsigned', reason: 'malformed' });
    expect(sig.checkGame({ ...VECTOR_GAME, signature: text('5') }, KEYS)).toMatchObject({ state: 'unsigned', reason: 'malformed' });
    expect(sig.checkGame({ ...VECTOR_GAME, signature: text('null') }, KEYS)).toMatchObject({ state: 'unsigned', reason: 'malformed' });
    expect(sig.checkGame({ ...VECTOR_GAME, signature: signatureFor(VECTOR_GAME, { v: 2 }) }, KEYS)).toMatchObject({
      state: 'unsigned',
      reason: 'version',
    });
  });

  it('המפתחות המוטבעים תואמים ל-kid שלהם, ומפתח הבדיקה לעולם אינו ביניהם', () => {
    for (const [kid, x] of Object.entries(sig.PUBLIC_KEYS)) expect(sig.keyIdFor(x)).toBe(kid);
    expect(Object.keys(sig.PUBLIC_KEYS)).not.toContain(KID);
    expect(sig.checkGame(signed())).toMatchObject({ state: 'unsigned', reason: 'unknown_key' });
  });

  it('תקלה בבדיקה עצמה היא "תקלה" ואינה זורקת', () => {
    expect(sig.checkGame(null, KEYS)).toMatchObject({ state: 'error', content: null });
    expect(sig.checkGame([VECTOR_GAME], KEYS)).toMatchObject({ state: 'error', content: null });
    expect(sig.checkGame('{"id":1}', KEYS)).toMatchObject({ state: 'error', content: null });
    expect(sig.checkGame(signed(), { [KID]: 'not-a-key' })).toMatchObject({ state: 'error', content: null });
  });

  it('קובץ שאי אפשר לגבב (קינון עמוק) אינו "תקלה": בלי חתימה, או "שונה" כשהחתימה במפתח מוכר', () => {
    // JSON.parse מקבל את הקינון, המנוע מתעלם משדה לא מוכר, ו"תקלה" לעולם אינה נועלת —
    // כך הייתה נפתחת דלת לכל קובץ.
    const deep = (depth: number) => JSON.parse(`${'['.repeat(depth)}${']'.repeat(depth)}`) as unknown;
    const junk = deep(200_000);
    expect(sig.checkGame({ ...signed(), junk }, KEYS)).toMatchObject({ state: 'invalid', reason: 'content', content: null });
    expect(sig.checkGame({ ...signed(), junk }, {})).toMatchObject({ state: 'unsigned', reason: 'unknown_key' });
    const plain: Record<string, unknown> = signed();
    delete plain.signature;
    expect(sig.checkGame({ ...plain, junk }, KEYS)).toMatchObject({ state: 'unsigned', reason: 'missing', content: null });
    expect(sig.checkGame({ ...signed(), id: junk }, KEYS)).toMatchObject({ state: 'invalid', content: null });
    expect(sig.checkStored({ ...plain, id: junk }, { userData: dir, keys: KEYS })).toMatchObject({ state: 'unsigned' });
  });
});

describe('signaturePolicy', () => {
  const ctx = (over: Partial<{ requireSigned: boolean; approved: boolean; sealed: boolean }> = {}) => ({
    requireSigned: false,
    approved: false,
    sealed: false,
    ...over,
  });
  const open = { demoOnly: false, why: null };

  it('קובץ ששונה — שחקני דמה בלבד, אלא אם המחשב אושר', () => {
    expect(sig.signaturePolicy({ state: 'invalid' }, ctx())).toEqual({ demoOnly: true, why: 'changed' });
    expect(sig.signaturePolicy({ state: 'invalid' }, ctx({ sealed: true }))).toEqual({ demoOnly: true, why: 'changed' });
    expect(sig.signaturePolicy({ state: 'invalid' }, ctx({ approved: true }))).toEqual(open);
  });

  it('קובץ בלי חתימה ננעל רק כשהמתג דולק, במחשב שלא אושר ולא ב-EXE סגור', () => {
    expect(sig.signaturePolicy({ state: 'unsigned' }, ctx())).toEqual(open);
    expect(sig.signaturePolicy({ state: 'unsigned' }, ctx({ requireSigned: true }))).toEqual({ demoOnly: true, why: 'unsigned' });
    expect(sig.signaturePolicy({ state: 'unsigned' }, ctx({ requireSigned: true, approved: true }))).toEqual(open);
    expect(sig.signaturePolicy({ state: 'unsigned' }, ctx({ requireSigned: true, sealed: true }))).toEqual(open);
  });

  it('חתימה תקינה ותקלה בבדיקה לעולם אינן נועלות', () => {
    expect(sig.signaturePolicy({ state: 'valid' }, ctx({ requireSigned: true }))).toEqual(open);
    expect(sig.signaturePolicy({ state: 'error' }, ctx({ requireSigned: true }))).toEqual(open);
  });
});

describe('תנאי הרישיון החתומים ו-EXE סגור', () => {
  const valid = (seal: unknown, admin: unknown = false) => ({
    state: 'valid',
    payload: { v: 1, game: GAME_A, content: VECTOR_CONTENT, seal, admin },
  });

  it('sealTermsOf קוראת את התנאים, וחבילה של מנהל או בלי חתימה תקינה — אין תנאים', () => {
    expect(sig.sealTermsOf(sig.checkGame(signed(), KEYS))).toEqual(BOTH);
    expect(sig.sealTermsOf(valid({ clickers: true, phones: false, room: null, limit: 50 }))).toEqual({
      clickers: true,
      phones: false,
      room: null,
      limit: 50,
    });
    expect(sig.sealTermsOf(valid({ room: '', limit: 0 }))).toEqual({ clickers: true, phones: true, room: null, limit: null });
    expect(sig.sealTermsOf(valid(BOTH, true))).toBeNull();
    expect(sig.sealTermsOf(valid(null))).toBeNull();
    expect(sig.sealTermsOf({ state: 'unsigned' })).toBeNull();
    expect(sig.sealTermsOf({ state: 'invalid' })).toBeNull();
  });

  it('boundSealConfig מצמצמת את התצורה לתנאים: מצב שלא ברישיון, החדר והמגבלה', () => {
    const config = { allowClickers: true, allowPhones: true, room: '9999', limit: 500, name: 'חידון' };
    expect(sig.boundSealConfig(config, { clickers: true, phones: false, room: null, limit: 20 })).toEqual({
      allowClickers: true,
      allowPhones: false,
      room: '9999',
      limit: 20,
      name: 'חידון',
    });
    expect(sig.boundSealConfig(config, BOTH)).toEqual({ ...config, room: '2047', limit: 20 });
    expect(sig.boundSealConfig({ ...config, limit: 5 }, BOTH).limit).toBe(5);
    expect(sig.boundSealConfig({ ...config, limit: null }, BOTH).limit).toBeNull();
    expect(sig.boundSealConfig(config, { ...BOTH, limit: null }).limit).toBe(500);
    expect(sig.boundSealConfig({ name: 'x' }, { clickers: false, phones: true, room: null, limit: null })).toMatchObject({
      allowClickers: false,
      allowPhones: true,
    });
  });

  it('בלי תנאים התצורה חוזרת כמו שהיא', () => {
    const config = { allowClickers: true, allowPhones: true, limit: 500 };
    expect(sig.boundSealConfig(config, null)).toBe(config);
  });
});

describe('חתימות ששמורות ליד הקבצים', () => {
  const unsignedGame = () => asRead({ ...VECTOR_GAME, id: GAME_A, credit: LICENSE });
  const sidecar = (content: string, data: unknown) => {
    mkdirSync(sig.signaturesDir(dir), { recursive: true });
    writeFileSync(join(sig.signaturesDir(dir), `${content}.json`), JSON.stringify(data));
  };

  it('קובץ בלי חתימה עם חתימה שמורה לתוכן שלו — תקין', () => {
    const g = unsignedGame();
    const content = sig.contentHash(g);
    sidecar(content, { signature: signatureFor(g), at: 1 });
    expect(sig.checkStored(g, { userData: dir, keys: KEYS })).toMatchObject({ state: 'valid', content, sidecar: true });
    expect(sig.checkStored(g, { userData: null, keys: KEYS })).toMatchObject({ state: 'unsigned', reason: 'missing' });
  });

  it('חתימה שמורה של תוכן אחר, סירוב או קובץ פגום — נשאר "בלי חתימה"', () => {
    const g = unsignedGame();
    const content = sig.contentHash(g);
    sidecar(content, { signature: signatureFor({ ...g, name: 'אחר' }), at: 1 });
    expect(sig.checkStored(g, { userData: dir, keys: KEYS })).toMatchObject({ state: 'unsigned', reason: 'missing' });
    sidecar(content, { refused: 'changed', at: 1 });
    expect(sig.checkStored(g, { userData: dir, keys: KEYS })).toMatchObject({ state: 'unsigned', reason: 'missing' });
    writeFileSync(join(sig.signaturesDir(dir), `${content}.json`), '{oops');
    expect(sig.checkStored(g, { userData: dir, keys: KEYS })).toMatchObject({ state: 'unsigned', reason: 'missing' });
  });

  it('חתימה שמורה אינה מכשירה קובץ שהחתימה שבתוכו נשברה', () => {
    const raised = signed();
    raised.setting.limit.number = 500;
    const content = sig.contentHash(raised);
    sidecar(content, { signature: signatureFor(raised), at: 1 });
    expect(sig.checkStored(raised, { userData: dir, keys: KEYS })).toMatchObject({ state: 'invalid', reason: 'content' });
  });

  it('שם קובץ שמור נגזר רק מ-hash תקין', () => {
    expect(sig.readSidecar(dir, '../device')).toBeNull();
    expect(sig.readSidecar(dir, VECTOR_CONTENT)).toBeNull();
  });
});

describe('סקירת הקבצים ובקשת חתימות לקבצים ישנים', () => {
  const writeGame = (name: string, game: unknown) => {
    const file = join(dir, name);
    writeFileSync(file, JSON.stringify(game));
    return file;
  };
  const readText = (p: string) => readFileSync(p, 'utf8');
  const old = (id: string, over: Record<string, unknown> = {}) => ({ ...VECTOR_GAME, id, credit: LICENSE, ...over });
  const NOW = 1_800_000_000_000;

  it('סופרת קבצים בלי חתימה תקינה, ומבקשת חתימה רק לקבצים שהורדו לפני החתימה', () => {
    const files = [
      { path: writeGame('a.zip', old(GAME_A)) },
      { path: writeGame('b.zip', old(GAME_B)) },
      { path: writeGame('signed.zip', signed()) },
      { path: writeGame('edited.zip', old(GAME_A, { name: 'נערך' })), edited: true },
      { path: writeGame('local.zip', old(GAME_A, { name: 'נבנה כאן' })), local: true },
      { path: writeGame('nolicense.zip', old(GAME_B, { name: 'בלי רישיון', credit: 'lic' })) },
      { path: writeGame('changed.zip', { ...signed(), name: 'שונה' }) },
      { path: writeGame('broken.zip', '{') },
      { path: join(dir, 'missing.zip') },
    ];
    const r = sig.surveyFiles({ userData: dir, files, readText, keys: KEYS, now: NOW });
    expect(r.unsigned).toBe(6);
    expect(r.sign).toEqual([
      { gameId: GAME_A, license: LICENSE, content: sig.contentHash(old(GAME_A)) },
      { gameId: GAME_B, license: LICENSE, content: sig.contentHash(old(GAME_B)) },
    ]);
  });

  it('קובץ שאי אפשר לגבב נספר כבלי חתימה, ואינו נשלח לחתימה', () => {
    const deep = 200_000;
    const file = join(dir, 'deep.zip');
    writeFileSync(file, `{"id":"${GAME_A}","credit":"${LICENSE}","junk":${'['.repeat(deep)}${']'.repeat(deep)}}`);
    expect(sig.surveyFiles({ userData: dir, files: [{ path: file }], readText, keys: KEYS, now: NOW })).toEqual({
      unsigned: 1,
      sign: [],
    });
  });

  it('בלי מפתחות מוטבעים לא מבקשים חתימות', () => {
    const files = [{ path: writeGame('a.zip', old(GAME_A)) }];
    expect(sig.surveyFiles({ userData: dir, files, readText, keys: {}, now: NOW })).toEqual({ unsigned: 1, sign: [] });
  });

  it('לכל היותר MAX_SIGN בקשות, ותוכן זהה נשלח פעם אחת', () => {
    const files = [writeGame('dup.zip', old(GAME_A)), writeGame('dup2.zip', old(GAME_A))].map((path) => ({ path }));
    for (let i = 0; i < 8; i++) files.push({ path: writeGame(`g${i}.zip`, old(GAME_B, { name: `משחק ${i}` })) });
    const r = sig.surveyFiles({ userData: dir, files, readText, keys: KEYS, now: NOW });
    expect(r.unsigned).toBe(10);
    expect(r.sign).toHaveLength(sig.MAX_SIGN);
    expect(new Set(r.sign.map((s) => s.content)).size).toBe(sig.MAX_SIGN);
  });

  it('חתימה שהמערכת החזירה נשמרת, הקובץ כבר אינו נספר, ואין בקשה נוספת', () => {
    const game = old(GAME_A);
    const files = [{ path: writeGame('a.zip', game) }];
    const first = sig.surveyFiles({ userData: dir, files, readText, keys: KEYS, now: NOW });
    const content = sig.contentHash(game);
    expect(
      sig.applySignatures({
        userData: dir,
        requested: first.sign,
        results: [{ gameId: GAME_A, content, signature: signatureFor(game) }],
        keys: KEYS,
        now: NOW,
      }),
    ).toEqual({ stored: 1, refused: 0 });
    expect(sig.surveyFiles({ userData: dir, files, readText, keys: KEYS, now: NOW })).toEqual({ unsigned: 0, sign: [] });
    expect(sig.checkStored(JSON.parse(readText(files[0]!.path)), { userData: dir, keys: KEYS })).toMatchObject({
      state: 'valid',
      sidecar: true,
    });
  });

  it('סירוב נשמר ולא שואלים שוב לפני שעבר שבוע; תקלה בשרת — שואלים בבדיקה הבאה', () => {
    const changed = old(GAME_A);
    const busy = old(GAME_B);
    const files = [{ path: writeGame('a.zip', changed) }, { path: writeGame('b.zip', busy) }];
    const first = sig.surveyFiles({ userData: dir, files, readText, keys: KEYS, now: NOW });
    expect(first.sign).toHaveLength(2);
    const result = sig.applySignatures({
      userData: dir,
      requested: first.sign,
      results: [
        { gameId: GAME_A, content: sig.contentHash(changed), reason: 'changed' },
        { gameId: GAME_B, content: sig.contentHash(busy), reason: 'unavailable' },
      ],
      keys: KEYS,
      now: NOW,
    });
    expect(result).toEqual({ stored: 0, refused: 1 });
    expect(sig.readSidecar(dir, sig.contentHash(changed))).toEqual({ refused: 'changed', at: NOW });
    expect(sig.readSidecar(dir, sig.contentHash(busy))).toBeNull();

    const soon = sig.surveyFiles({ userData: dir, files, readText, keys: KEYS, now: NOW + sig.REFUSAL_RETRY_MS - 1 });
    expect(soon.sign.map((s) => s.gameId)).toEqual([GAME_B]);
    expect(soon.unsigned).toBe(2);
    const later = sig.surveyFiles({ userData: dir, files, readText, keys: KEYS, now: NOW + sig.REFUSAL_RETRY_MS });
    expect(later.sign.map((s) => s.gameId)).toEqual([GAME_A, GAME_B]);
  });

  it('חתימה שאינה עוברת כאן (מפתח אחר, תוכן אחר) נרשמת כסירוב ולא נשמרת', () => {
    const game = old(GAME_A);
    const content = sig.contentHash(game);
    const requested = [{ gameId: GAME_A, license: LICENSE, content }];
    sig.applySignatures({
      userData: dir,
      requested,
      results: [{ gameId: GAME_A, content, signature: { ...signatureFor(game), kid: '0000000000000000' } }],
      keys: KEYS,
      now: NOW,
    });
    expect(sig.readSidecar(dir, content)).toEqual({ refused: 'unknown_key', at: NOW });
    sig.applySignatures({
      userData: dir,
      requested,
      results: [{ gameId: GAME_A, content, signature: signatureFor({ ...game, name: 'אחר' }) }],
      keys: KEYS,
      now: NOW,
    });
    expect(sig.readSidecar(dir, content)).toEqual({ refused: 'bad_signature', at: NOW });
  });

  it('תשובה על קובץ שלא נשלח, או עם מזהה משחק אחר — מתעלמים', () => {
    const game = old(GAME_A);
    const content = sig.contentHash(game);
    const r = sig.applySignatures({
      userData: dir,
      requested: [{ gameId: GAME_A, license: LICENSE, content }],
      results: [
        { gameId: GAME_B, content, signature: signatureFor(game) },
        { gameId: GAME_A, content: VECTOR_CONTENT, signature: VECTOR_SIGNATURE },
        { gameId: GAME_A, content: 'f'.repeat(64), reason: 'changed' },
      ],
      keys: KEYS,
      now: NOW,
    });
    expect(r).toEqual({ stored: 0, refused: 0 });
    expect(sig.readSidecar(dir, content)).toBeNull();
  });

  it('★ מקצה לקצה: חבילה ישנה בספרייה מקבלת חתימה שנשמרת לידה, והקובץ עצמו לא משתנה', async () => {
    const game = old(GAME_A);
    const zip = join(dir, 'games', '123456.zip');
    mkdirSync(join(dir, 'games'), { recursive: true });
    await writeStoreZip(zip, [{ path: 'data.json', data: JSON.stringify(game, null, 2) }]);
    const before = readFileSync(zip);
    const files = [{ path: zip }];
    const survey = sig.surveyFiles({ userData: dir, files, readText: lib.readPackageText, keys: KEYS, now: NOW });
    expect(survey).toEqual({ unsigned: 1, sign: [{ gameId: GAME_A, license: LICENSE, content: sig.contentHash(game) }] });
    const results = survey.sign.map((r) => ({ gameId: r.gameId, content: r.content, signature: signatureFor(game) }));
    expect(sig.applySignatures({ userData: dir, requested: survey.sign, results, keys: KEYS, now: NOW })).toEqual({ stored: 1, refused: 0 });
    const loaded = JSON.parse(lib.readPackageText(zip)!);
    expect(sig.checkStored(loaded, { userData: dir, keys: KEYS })).toMatchObject({ state: 'valid', sidecar: true });
    expect(readFileSync(zip).equals(before)).toBe(true);
    expect(sig.surveyFiles({ userData: dir, files, readText: lib.readPackageText, keys: KEYS, now: NOW })).toEqual({ unsigned: 0, sign: [] });
  });

  it('קובץ נקרא מהדיסק רק כשהוא חדש או השתנה', () => {
    const file = writeGame('a.zip', old(GAME_A));
    let reads = 0;
    const counting = (p: string) => {
      reads += 1;
      return readText(p);
    };
    sig.surveyFiles({ userData: dir, files: [{ path: file }], readText: counting, keys: KEYS, now: NOW });
    sig.surveyFiles({ userData: dir, files: [{ path: file }], readText: counting, keys: KEYS, now: NOW });
    expect(reads).toBe(1);
    writeFileSync(file, JSON.stringify(old(GAME_A, { name: 'שונה' })));
    utimesSync(file, new Date(NOW), new Date(NOW));
    const r = sig.surveyFiles({ userData: dir, files: [{ path: file }], readText: counting, keys: KEYS, now: NOW });
    expect(reads).toBe(2);
    expect(r.sign[0]?.content).toBe(sig.contentHash(old(GAME_A, { name: 'שונה' })));
  });
});
