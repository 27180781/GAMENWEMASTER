# Trivia Engine — מנוע משחק טריוויה אינטראקטיבי

מנוע משחק טריוויה מונע-JSON למסך גדול באירועים חיים, עם תמיכה באונליין (WebSocket לפי חדר) ואופליין (קליקרים / ZIP).

## מבנה הריפו

```
SPEC.md          ← המפרט המלא והמחייב. קרא אותו לפני כתיבת קוד.
PROMPT-M1.md     ← הפרומפט הראשוני ל-Claude Code (Milestone 1).
fixtures/        ← 4 קבצי משחק JSON אמיתיים מהפרודקשן (מקור האמת לפורמט).
```

## הקבצים לבדיקה (fixtures)

| קובץ | שקופיות | סוגים | הערה |
|---|---|---|---|
| `masaa-sync-manual-link.json` | 71 | subject, media, survey, ans_images | מכיל שקופיות `image_URL` + `{{GAMA_ID}}`, `Send_data`, ו-YouTube רבים |
| `beficha-uvilvavcha.json` | 37 | media, trivia, survey, subject | מכיל `scoringReduction` פעיל בחלק מהשקופיות |
| `hadassah-ozen.json` | 24 | trivia, survey | מכיל שקופיות עם 4 **וגם** 5 תשובות |
| `neuwirth.json` | 61 | media, trivia, survey | תשובות של 3 בלבד |

יחד הם מכסים את כל 5 סוגי השקופיות, את כל מקרי הקצה של שדות ריקים (`""`), ומספרי תשובות משתנים.

## התחלה

1. קרא את `SPEC.md`.
2. הדבק את `PROMPT-M1.md` ל-Claude Code והתחל מ-Milestone 1.
3. בסיום כל milestone: `npm test` ירוק לפני מעבר לשלב הבא.

## סטאק

React 18 + TypeScript (strict) + Vite · Zod לולידציה · Vitest לבדיקות. פריסה מיועדת ל-Lovable.
