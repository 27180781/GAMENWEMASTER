# פרומפט ראשוני ל-Claude Code — הקמת פרויקט + Milestone 1

> להדביק ב-Claude Code אחרי clone של הריפו הריק.
> לפני ההרצה: להעתיק לריפו את `SPEC.md` (המפרט המלא) ואת 4 קבצי המשחק לתיקיית `fixtures/`.

---

אתה בונה מנוע משחק טריוויה אינטראקטיבי למסך גדול באירועים חיים.
המפרט המלא והמחייב נמצא בקובץ `SPEC.md` בשורש הריפו — **קרא אותו במלואו לפני שאתה כותב שורת קוד**. בתיקיית `fixtures/` יש 4 קבצי משחק JSON אמיתיים מהפרודקשן — הם מקור האמת לפורמט, כולל כל מקרי הקצה.

במשימה הזו אתה מבצע **אך ורק את Milestone 1 (סעיף 10 במפרט)**. אל תבנה UI של משחק, אל תבנה רשת, אל תבנה preload. אלה שלבים הבאים.

## הקמת הפרויקט

- Vite + React 18 + TypeScript strict. פריסה עתידית ב-Lovable, אז מבנה סטנדרטי של Vite (index.html בשורש, `src/`).
- Vitest לבדיקות.
- Zod לולידציה.
- ESLint + Prettier בסיסיים.
- מבנה תיקיות:

```
src/
  engine/          # ליבה טהורה — אסור לייבא React או DOM לכאן
    schema.ts      # סכמות Zod + טיפוסים
    loader.ts      # טעינת JSON, ולידציה, נרמול
    classify.ts    # classifySubjectSlide + זיהוי סוג מדיה לפי URL
    gameEngine.ts  # מכונת המצבים
    types.ts       # GameState, GameEvent, GameSnapshot
  debug/           # מסך דיבאג זמני (M1 בלבד)
fixtures/          # 4 קבצי המשחק
tests/
```

## תכולת M1 — לפי הסדר

### 1. סכמת Zod מלאה (`schema.ts`)
לפי סעיף 3 במפרט. דגשים שאסור לפספס:
- שדות מספריים ריקים מגיעים כמחרוזת ריקה `""` — נרמול לברירות מחדל (time=15, score=0, seconds=0) בתוך transform.
- מספר תשובות משתנה: 3, 4 או 5.
- צבעים בפורמט HEX של 8 ספרות (עם אלפא) או 6.
- `assets[].type` לא אמין — לא להסתמך עליו.
- שגיאות ולידציה בעברית עם ציון שקופית ושדה.

### 2. מסווגים (`classify.ts`)
- `classifySubjectSlide(que)` → `'dynamic-image' | 'send-data' | 'plain'` לפי סעיף 4 במפרט.
- `classifyMediaUrl(src)` → `'youtube' | 'image' | 'video' | 'audio' | 'unknown'` לפי ה-URL בלבד.

### 3. מנוע המשחק (`gameEngine.ts`)
מחלקה טהורה לפי סעיפים 1, 5, 7 במפרט:
- `dispatch(event: GameEvent)` — האירועים: `ADVANCE`, `BACK`, `GOTO(slideId)`, `VOTE_SNAPSHOT(s)`, `VOTING_TIMEOUT`, `MEDIA_ENDED`.
- מכונת המצבים המלאה של מחזור חיי שקופית (סעיף 5.1) כולל openMedia/endMedia, פתיחת/סגירת הצבעה, טיימר (המנוע מקבל `VOTING_TIMEOUT` מבחוץ — הוא לא מריץ setTimeout בעצמו).
- לוגיקת ניקוד מלאה (סעיף 5.2): trivia, scoringReduction, firstClicker, correctlyAnsweredBefore.
- `serialize()` / `restore(snapshot)` לפי סעיף 7.1.
- מנגנון subscribe לשינויי state (יחובר בהמשך ל-React דרך useSyncExternalStore).

### 4. בדיקות (חובה — זה עיקר ה-Milestone)
- כל אחד מ-4 קבצי ה-fixtures נטען ועובר ולידציה בהצלחה.
- `classifySubjectSlide` נבדק מול הטקסטים האמיתיים מהקבצים: שקופיות `image_URL` עם `{{GAMA_ID}}`, שקופית `Send_data`, ושקופיות טקסט רגילות ("סגרו את הכרטיסיה" חייבת לחזור `'plain'`).
- סימולציית משחק מלא: הרצת fixture מתחילתו לסופו עם ReplayAdapter פשוט שמזרים VoteSnapshots מזויפים, ואימות: מעברי מצבים תקינים, ניקוד נכון (כולל מקרה scoringReduction ומקרה firstClicker), serialize→restore מחזיר מצב זהה (round-trip).
- בדיקת קצה: קובץ עם שדות `""`, שקופית עם 3 תשובות ושקופית עם 5.

### 5. מסך דיבאג (`debug/`)
עמוד אחד פשוט: בחירת fixture, כפתורי ADVANCE/BACK, תצוגת ה-state הנוכחי כ-JSON מעוצב, והזרקת VoteSnapshot ידנית. בלי עיצוב — כלי עבודה בלבד.

## כללי עבודה

- TypeScript strict, אסור `any` ב-`src/engine/`.
- קומיטים קטנים עם הודעות ברורות אחרי כל תת-שלב (schema → classify → engine → tests → debug).
- בסיום: `npm test` ירוק, `npm run build` עובר, ו-README קצר עם הוראות הרצה.
- אם משהו בקבצי ה-fixtures סותר את המפרט — **הקבצים גוברים**. תעד את הפער בהערה ותמשיך.

התחל.
