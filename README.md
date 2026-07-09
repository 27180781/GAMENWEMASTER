# Trivia Engine — מנוע משחק טריוויה אינטראקטיבי

מנוע משחק טריוויה מונע-JSON למסך גדול באירועים חיים, עם תמיכה באונליין (WebSocket לפי חדר) ואופליין (קליקרים / ZIP).

## מבנה הריפו

```
SPEC.md          ← המפרט המלא והמחייב. קרא אותו לפני כתיבת קוד.
PROMPT-M1.md     ← הפרומפט הראשוני ל-Claude Code (Milestone 1).
fixtures/        ← 4 קבצי משחק JSON אמיתיים מהפרודקשן (מקור האמת לפורמט).
src/engine/      ← ליבה טהורה: סכמות Zod, טעינה, מסווגים, מכונת המצבים. בלי React/DOM.
src/render/      ← הרנדרר (M2): שקופיות, טיימר, זוכים, תפריט מפעיל, עיצוב RTL.
src/app/         ← שכבת ה-host (M2): טיימרים, מקלדת, סאונד, קהל סינתטי, ניתוב.
src/debug/       ← מסך דיבאג (‎#debug בכתובת).
tests/           ← בדיקות Vitest על הקבצים האמיתיים + סימולציות מלאות.
```

## הרצה

```bash
npm install
npm test         # 65 בדיקות: ולידציה, מסווגים, מנוע, סימולציית משחק מלא
npm run dev      # המשחק ב-http://localhost:5173 (מסך דיבאג: ‎/#debug)
npm run build    # tsc + vite build
npm run lint
```

### שליטת מנחה — זרימת שלבים

המשחק מתקדם בשלבים, כל מעבר ב**רווח** (מקלדת) או **0** (שלט מנחה / טלפון):

```
כניסה לשקופית → [מדיית פתיחה] → הצגת השאלה → חשיפת כל תשובה בלחיצה
→ לחיצה להפעלת הטיימר ופתיחת ההצבעה → עצירת הטיימר (אם לא נגמר לבד)
→ חשיפת התשובה הנכונה → [מדיית סיום] → השקופית הבאה
```

**פקודות מנחה** (מקלדת או שלט מנחה):
| מקש | פעולה |
|---|---|
| רווח / 0 | השלב הבא |
| 2 | שלב אחד אחורה (עד חזרת שקופית) |
| 1 | מסך מובילים ↔ חזרה למשחק |
| 3 | סאונד מחיאות כפיים |
| 4 / 5 | ‏10+ / ‏10- שניות לטיימר הפעיל |
| 6 | עצירת הטיימר וההצבעה ↔ המשך |

בנוסף: ‏Backspace = שקופית שלמה אחורה (עם אישור) · ESC = תפריט מפעיל (קפיצה לשקופית, ווליום, קהל סינתטי, סיום משחק).

**שלט מנחה:** במסך הגדרות הדמו אפשר להזין מזהה קליקר / מספר טלפון — ההקשות שלו מפורשות כפקודות המנחה שלמעלה, מסוננות מההצבעות, והוא אינו משתתף במשחק.

## טעינה מקישור ומצב דמו

```
https://<host>/?game=<URL של game.json>            ← פותח את המשחק מהקובץ שבכתובת
https://<host>/?game=<URL של game.json>&demo=1     ← מצב דמו: שחקני דמה במקום סוקט
```

- ‏`?game=` — הקובץ נטען מהכתובת (fetch), עובר את אותה ולידציה, ונפתח ישירות במסך הפתיחה. שגיאת טעינה/ולידציה מוצגת בעברית. (השרת המגיש את הקובץ צריך לאפשר CORS.)
- ‏`&demo=1` — לפני המשחק נפתח **מסך הגדרות דמו**: כמות שחקני דמה (עד 5,000), מהירות הצבעה (איטי/רגיל/מהיר/בזק), אחוז עונים נכון, וקצב עדכוני ההצבעות. ההבדל היחיד ממשחק אמיתי: ה-VoteSnapshots מגיעים משחקני הדמה במקום מהסוקט — לבחינת ביצועי המערכת תחת עומס.
- בלי `demo` ההצבעות ימתינו ל-SocketAdapter (יגיע ב-M3); אפשר להדליק קהל דמה ידנית מתפריט המפעיל (ESC).

## פריסה

### פרודקשן — CapRover (אוטומטי בכל מיזוג ל-main)

האפליקציה סטטית: כל מסך משחק נטען עם `?game=<URL>` משלו וכל הלוגיקה רצה בדפדפן — שרת nginx אחד מגיש מאות משחקים במקביל ללא מאמץ.

הגדרה חד-פעמית:
1. ב-CapRover: צור אפליקציה (למשל `trivia-engine`), הפעל HTTPS, וב-**Deployment** הפעל **App Token** והעתק אותו.
2. בגיטהאב: ‏Settings → Secrets and variables → Actions → הוסף 3 סודות:
   - `CAPROVER_SERVER` — ‏`https://captain.<root-domain>` של השרת
   - `CAPROVER_APP` — שם האפליקציה
   - `CAPROVER_APP_TOKEN` — הטוקן שהעתקת
3. מכאן ואילך כל מיזוג ל-`main` מריץ בדיקות ופורס אוטומטית (workflow: ‏`deploy-caprover.yml`). עד שהסודות מוגדרים שלב הפריסה מדלג בשקט.

הפריסה משתמשת ב-`Dockerfile` (בנייה + הגשה עם nginx) ו-`captain-definition` שבשורש — אפשר גם לפרוס ידנית עם `caprover deploy` מקומי.

### שולחן עבודה — EXE אופליין (Electron)

גרסת שולחן עבודה נארזת כ-**EXE נייד ל-Windows** (Electron portable) — קובץ בודד, בלי התקנה, רץ אופליין לגמרי:

- **עמוד הורדה:** `<host>/download.html` (מצביע ל-Release האחרון בגיטהאב).
- **בנייה אוטומטית:** `.github/workflows/build-desktop.yml` בונה את ה-EXE על `windows-latest` בכל דחיפה ל-`main` ומפרסם אותו ל-Release בשם `desktop-latest`. הקישור היציב:
  `https://github.com/27180781/GAMENWEMASTER/releases/download/desktop-latest/TriviaEngine-Portable.exe`
- **שני יעדים:** `TriviaEngine-Setup.exe` (מתקין עם קיצור דרך בשולחן העבודה ובתפריט התחל, בלי הרשאות מנהל) ו-`TriviaEngine-Portable.exe` (נייד, בלי התקנה). שניהם מתעדכנים באותו Release בכל דחיפה ל-main.
- **בנייה מקומית** (על Windows): `npm run dist:win` → הפלט ב-`release/`.
- **פיתוח מקומי:** `npm run electron:dev` (דורש הורדת בינארי Electron — חסום בחלק מהסביבות המבודדות).

הליבה (`src/engine/`) רצה בדפדפן ולכן פועלת אופליין ללא שינוי. מדיה מרוחקת (יוטיוב / וידאו בענן) עדיין דורשת אינטרנט — תמיכה במשחק ארוז מקומית (ZIP) + placeholder ליוטיוב תיווסף ב-Milestone 5. קליקרים: מקלדת / קליקר-מצגת עובדים כבר; קליקרי קהל (base station) ייכנסו כ-adapter מאחורי `VoteAdapter`.

### דמו — GitHub Pages

‏`deploy-pages.yml` מפרסם את ה-build לענף `gh-pages` בכל מיזוג ל-`main`:
`https://27180781.github.io/GAMENWEMASTER/` (דורש הפעלה חד-פעמית של Pages בהגדרות הריפו: Source = Deploy from a branch → ‏gh-pages).

## סטטוס — Milestone 1 (ליבה) ✅

- **`src/engine/schema.ts`** — סכמת Zod מלאה עם נרמול: שדות מספריים ריקים (`""`) → ברירות מחדל (time=15, score=0, seconds=0); 3/4/5 תשובות; צבעי HEX של 6/8 ספרות.
- **`src/engine/loader.ts`** — טעינה עם שגיאות ולידציה בעברית כולל מיקום: `שקופית 7 (id=7): question.scoreForQue — חייב להיות מספר`.
- **`src/engine/classify.ts`** — `classifySubjectSlide` (dynamic-image / send-data / plain) ו-`classifyMediaUrl` לפי URL בלבד (`assets[].type` לא אמין — YouTube רשום שם כ-"image").
- **`src/engine/gameEngine.ts`** — מכונת מצבים טהורה: `dispatch(ADVANCE | BACK | GOTO | VOTE_SNAPSHOT | VOTING_TIMEOUT | MEDIA_ENDED)`, ניקוד מלא (scoringReduction, firstClicker, correctlyAnsweredBefore), `serialize()`/`restore()`, מנגנון subscribe (מוכן ל-useSyncExternalStore).
- **`src/engine/replayAdapter.ts`** — מקור הצבעות לפיתוח/בדיקות.
- **מסך דיבאג** — בחירת fixture, כפתורי אירועים, הזרקת VoteSnapshot ידנית, תצוגת state.

### הערות מימוש

- המנוע **חסר שעון**: זמן מוזרק דרך שדה `at` (ms) על האירועים. `VOTING_TIMEOUT` מגיע מה-host — המנוע לא מריץ טיימרים. בלי `at` — scoringReduction לא מופעלת (ניקוד מלא).
- **פער מתועד בין ה-fixtures למפרט**: אף שקופית ב-4 הקבצים לא מגיעה עם `scoringReduction.active=true` או `firstClicker=true` (בניגוד לנטען כאן קודם לגבי beficha). הלוגיקה ממומשת ונבדקת על עותקי fixtures עם הדגלים מודלקים.
- Side effects של שקופיות פקודה (תמונה דינמית / Send_data) נחשפים כ-`state.subjectCommand` — הביצוע בפועל (fetch/שליחה, retry) הוא באחריות שכבת ה-host (מ-M2 והלאה).

## הקבצים לבדיקה (fixtures)

| קובץ | שקופיות | סוגים | הערה |
|---|---|---|---|
| `masaa-sync-manual-link.json` | 71 | subject, media, survey, ans_images | מכיל שקופיות `image_URL` + `{{GAMA_ID}}`, `Send_data`, ו-YouTube רבים |
| `beficha-uvilvavcha.json` | 37 | media, trivia, survey, subject | 16 שקופיות עם `scoringReduction` מוגדר אך `active:false` |
| `hadassah-ozen.json` | 24 | trivia, survey | מכיל שקופיות עם 4 **וגם** 5 תשובות |
| `neuwirth.json` | 61 | media, trivia, survey | תשובות של 3 בלבד |

יחד הם מכסים את כל 5 סוגי השקופיות, את כל מקרי הקצה של שדות ריקים (`""`), ומספרי תשובות משתנים.

## אבני דרך

1. ✅ **M1 — ליבה**: סכמה, טעינה, מסווגים, מנוע + בדיקות.
2. ✅ **M2 — רנדרר**: כל סוגי השקופיות, RTL, צבעים, סאונד, טיימר, מסכי זוכים, קהל סינתטי דרך ReplayAdapter — המשחק ניתן להרצה מלאה בלי שרת (זה המצב הנוכחי).
3. **M3 — רשת**: SocketAdapter, reconnect, seq, heartbeat.
4. **M4 — עמידות**: Preload, Cache API, גיבוי/שחזור.
5. **M5 — אופליין**: ZIP, נכסים מקומיים, כתיבה אטומית.

בסיום כל milestone: `npm test` ירוק לפני מעבר לשלב הבא.

## סטאק

React 18 + TypeScript (strict) + Vite · Zod לולידציה · Vitest לבדיקות. פריסה מיועדת ל-Lovable.
