#!/usr/bin/env node
/**
 * seal-game — אורז משחק (ZIP) לתוך ה-EXE הנייד הגנרי ומייצר EXE ייחודי "סגור".
 * ה-EXE שנוצר טוען את המשחק אוטומטית בהפעלה (בלי בורר קבצים, לא ניתן להחלפה),
 * עם הגדרות מקור-הצבעה שנקבעות כאן. אין צורך לבנות Electron מחדש לכל משחק.
 *
 * שימוש:
 *   node tools/seal-game.mjs \
 *     --exe TriviaEngine-Portable.exe \   קובץ ה-EXE הגנרי (מעמוד ההורדות)
 *     --game mygame.zip \                 קובץ המשחק (ZIP עם data.json + נכסים)
 *     --out MyGame.exe \                  ה-EXE הייחודי שייווצר
 *     [--room ABC123] \                   קוד חדר לטלפונים (בלי = אין טלפונים)
 *     [--clickers true|false] \           לאפשר שלטים (ברירת מחדל: כן)
 *     [--phones true|false] \             לאפשר טלפונים (ברירת מחדל: כן אם יש room)
 *     [--limit 200] \                     מגבלת משתתפים (בלי = כמו ב-JSON)
 *     [--name "שם המשחק"]                 שם לתצוגה
 *
 * מיועד להרצה בשרת שיוצר את המשחקים — קלט קובץ משחק ⇒ פלט EXE ייחודי.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { sealPayload } = require(join(here, '..', 'electron', 'sealPayload.cjs'));

/** פענוח דגלי CLI פשוט: --key value, וגם --flag (בוליאני = true). */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function asBool(v, dflt) {
  if (v === undefined) return dflt;
  if (v === true) return true;
  return /^(1|true|yes|כן)$/i.test(String(v));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const exePath = args.exe;
  const gamePath = args.game;
  const outPath = args.out;
  if (!exePath || !gamePath || !outPath) {
    console.error('חסרים פרמטרים. חובה: --exe <generic.exe> --game <game.zip> --out <out.exe>');
    console.error('אופציונלי: --room <code> --clickers true|false --phones true|false --limit <n> --name <name>');
    process.exit(2);
  }

  const room = args.room !== undefined && args.room !== true ? String(args.room) : '';
  const limit =
    args.limit !== undefined && args.limit !== true && String(args.limit).trim() !== ''
      ? Number(args.limit)
      : null;
  const config = {
    room,
    allowClickers: asBool(args.clickers, true),
    // טלפונים מותרים כברירת מחדל רק אם יש קוד חדר; --phones דורס.
    allowPhones: asBool(args.phones, room !== ''),
    limit: Number.isFinite(limit) ? limit : null,
    name: args.name !== undefined && args.name !== true ? String(args.name) : '',
  };
  if (config.allowPhones && room === '') {
    console.error('⚠ --phones true דורש --room <code>. מבטל טלפונים.');
    config.allowPhones = false;
  }

  const exeBuf = readFileSync(exePath);
  const gameBuf = readFileSync(gamePath);
  const sealed = sealPayload(exeBuf, gameBuf, config);
  writeFileSync(outPath, sealed);

  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  console.log(`✅ נוצר EXE סגור: ${outPath} (${mb(sealed.length)}MB)`);
  console.log(`   משחק: ${config.name || '(ללא שם)'} · ${mb(gameBuf.length)}MB`);
  console.log(
    `   מקורות: ${config.allowClickers ? 'שלטים' : ''}${config.allowClickers && config.allowPhones ? ' + ' : ''}${config.allowPhones ? `טלפונים (חדר ${room})` : ''}` +
      `${config.limit !== null ? ` · מגבלה ${config.limit}` : ''}`,
  );
}

main();
