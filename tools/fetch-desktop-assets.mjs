/**
 * מוריד את קובצי ההתקנה של תוכנת האופליין אל תוך אתר המשחק, כדי שהלקוח
 * יוריד ויתעדכן **מהשרת של המשחק בלבד** ולא יפנה ל-GitHub.
 *
 * רץ בזמן בניית תמונת ה-Docker (ראו Dockerfile), כלומר בצד השרת/CI — הלקוח
 * לעולם אינו רואה את המקור. הבנייה נכשלת ברעש אם קובץ חסר או פגום, במקום
 * שהתקלה תתגלה בשקט אצל לקוח באמצע אירוע.
 *
 * שימוש: node tools/fetch-desktop-assets.mjs <תיקיית-יעד>
 * משתני סביבה:
 *   DESKTOP_SOURCE_URL — מקור הקבצים (ברירת מחדל: המהדורה היציבה ב-GitHub)
 *   DESKTOP_ASSETS     — '0' כדי לדלג (בנייה מקומית מהירה בלי 200MB הורדות)
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, statSync, linkSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE =
  process.env.DESKTOP_SOURCE_URL ??
  'https://github.com/27180781/GAMENWEMASTER/releases/download/desktop-latest';

const outDir = process.argv[2] ?? 'dist/desktop';

/** גודל מינימלי סביר ל-EXE של Electron — שומר מפני "הורדה" של דף שגיאה. */
const MIN_EXE_BYTES = 40 * 1024 * 1024;

/** הורדה עם כמה ניסיונות — כשל רשתי חולף לא אמור להפיל בנייה שלמה. */
async function fetchWithRetry(url, tries = 4) {
  let lastErr;
  for (let i = 1; i <= tries; i += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (i < tries) {
        const wait = 2 ** i * 1000;
        console.warn(`  ניסיון ${i} נכשל (${err.message}) — ממתין ${wait / 1000} שנ׳`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new Error(`הורדה נכשלה: ${url} — ${lastErr?.message ?? 'לא ידוע'}`);
}

const sha512b64 = (buf) => createHash('sha512').update(buf).digest('base64');

async function main() {
  if (process.env.DESKTOP_ASSETS === '0') {
    console.log('DESKTOP_ASSETS=0 — מדלגים על הורדת קובצי ההתקנה.');
    return;
  }

  mkdirSync(outDir, { recursive: true });

  // ‎latest.yml‎ הוא מקור האמת: הוא קובע איזה קובץ התקנה ה-updater יבקש,
  // ומה ה-sha512 שלו. לכן קוראים אותו קודם ומורידים בדיוק את מה שהוא מציין.
  console.log(`מוריד latest.yml מ-${SOURCE}`);
  const feed = (await fetchWithRetry(`${SOURCE}/latest.yml`)).toString('utf8');
  const version = /^version:\s*(.+)$/m.exec(feed)?.[1]?.trim();
  const installer = /^path:\s*(.+)$/m.exec(feed)?.[1]?.trim();
  const wantHash = /^sha512:\s*(.+)$/m.exec(feed)?.[1]?.trim();
  if (!version || !installer || !wantHash) {
    throw new Error('latest.yml אינו בפורמט הצפוי (חסר version/path/sha512)');
  }
  console.log(`גרסה ${version} · מתקין ${installer}`);
  writeFileSync(join(outDir, 'latest.yml'), feed);

  // (1) המתקין — זה מה שהעדכון האוטומטי מוריד. מאמתים מול ה-sha512 שבפיד:
  // קובץ שלא תואם יידחה על ידי electron-updater אצל הלקוח, ועדיף לגלות כאן.
  console.log(`מוריד ${installer} …`);
  const setup = await fetchWithRetry(`${SOURCE}/${installer}`);
  const gotHash = sha512b64(setup);
  if (gotHash !== wantHash) {
    throw new Error(`sha512 של ${installer} אינו תואם ל-latest.yml — הקובץ פגום`);
  }
  if (setup.length < MIN_EXE_BYTES) throw new Error(`${installer} קטן מדי (${setup.length})`);
  writeFileSync(join(outDir, installer), setup);
  console.log(`  ✓ ${(setup.length / 1048576).toFixed(0)}MB · sha512 תואם`);

  // (2) הקובץ הנייד — להורדה ישירה, וגם הבסיס שכלי החתימה מוריד.
  const portable = `HavayaBeClick-${version}.exe`;
  console.log(`מוריד ${portable} …`);
  const exe = await fetchWithRetry(`${SOURCE}/${portable}`);
  if (exe.length < MIN_EXE_BYTES) throw new Error(`${portable} קטן מדי (${exe.length})`);
  writeFileSync(join(outDir, portable), exe);
  console.log(`  ✓ ${(exe.length / 1048576).toFixed(0)}MB`);

  // שמות יציבים, שאינם תלויי גרסה — עמוד ההורדה וכלי החתימה מקשרים אליהם.
  // קישור קשיח ולא עותק: אלו אותם בייטים בדיוק, והעתקה הייתה מנפחת את תמונת
  // ה-Docker מ-205MB ל-512MB. שכבת ה-tar שומרת תוכן משותף פעם אחת, ו-nginx
  // מגיש קישור קשיח כמו כל קובץ.
  const alias = (from, to) => {
    const target = join(outDir, to);
    rmSync(target, { force: true });
    linkSync(join(outDir, from), target);
    console.log(`  ↳ ${to}`);
  };
  alias(installer, 'TriviaEngine-Setup.exe');
  alias(portable, 'TriviaEngine-Portable.exe');
  alias(portable, 'SealEXE.exe');

  // אינדקס קטן — נוח לבדיקה ידנית שהשרת באמת מגיש את הגרסה הנכונה.
  writeFileSync(
    join(outDir, 'index.json'),
    `${JSON.stringify({ version, installer, portable, source: SOURCE, builtAt: new Date().toISOString() }, null, 2)}\n`,
  );

  // נפח אמיתי — סופרים כל inode פעם אחת, כי הקישורים הקשיחים חולקים תוכן.
  const seen = new Set();
  let total = 0;
  for (const f of ['latest.yml', installer, portable, 'TriviaEngine-Setup.exe', 'TriviaEngine-Portable.exe', 'SealEXE.exe', 'index.json']) {
    const st = statSync(join(outDir, f));
    if (seen.has(st.ino)) continue;
    seen.add(st.ino);
    total += st.size;
  }
  console.log(`סה״כ ${(total / 1048576).toFixed(0)}MB ב-${outDir} (${seen.size} קבצים ייחודיים)`);
}

main().catch((err) => {
  console.error(`\n✗ הורדת קובצי ההתקנה נכשלה: ${err.message}`);
  rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
});
