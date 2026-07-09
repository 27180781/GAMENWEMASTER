# Trivia Engine — מנוע משחק טריוויה אינטראקטיבי

מנוע משחק טריוויה מונע-JSON למסך גדול באירועים חיים, עם תמיכה באונליין (WebSocket לפי חדר) ואופליין (קליקרים / ZIP).

## מבנה הריפו

```
SPEC.md          ← המפרט המלא והמחייב. קרא אותו לפני כתיבת קוד.
PROMPT-M1.md     ← הפרומפט הראשוני ל-Claude Code (Milestone 1).
fixtures/        ← 4 קבצי משחק JSON אמיתיים מהפרודקשן (מקור האמת לפורמט).
src/engine/      ← ליבה טהורה: סכמות Zod, טעינה, מסווגים, מכונת המצבים. בלי React/DOM.
src/debug/       ← מסך דיבאג זמני (M1 בלבד).
tests/           ← בדיקות Vitest על הקבצים האמיתיים + סימולציות מלאות.
```

## הרצה

```bash
npm install
npm test         # 59 בדיקות: ולידציה, מסווגים, מנוע, סימולציית משחק מלא
npm run dev      # מסך הדיבאג ב-http://localhost:5173
npm run build    # tsc + vite build
npm run lint
```

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

1. ✅ **M1 — ליבה**: סכמה, טעינה, מסווגים, מנוע + בדיקות (זה המצב הנוכחי).
2. **M2 — רנדרר**: כל סוגי השקופיות, RTL, צבעים, סאונד, טיימר, מסכי זוכים.
3. **M3 — רשת**: SocketAdapter, reconnect, seq, heartbeat.
4. **M4 — עמידות**: Preload, Cache API, גיבוי/שחזור.
5. **M5 — אופליין**: ZIP, נכסים מקומיים, כתיבה אטומית.

בסיום כל milestone: `npm test` ירוק לפני מעבר לשלב הבא.

## סטאק

React 18 + TypeScript (strict) + Vite · Zod לולידציה · Vitest לבדיקות. פריסה מיועדת ל-Lovable.
