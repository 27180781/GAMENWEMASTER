# מפרט בנייה: מנוע משחק טריוויה אינטראקטיבי (Game Engine)

> **ייעוד המסמך:** פרומפט מפרט מלא לבנייה ב-Claude Code ופריסה ב-Lovable.
> יש לבנות לפי סדר אבני הדרך (Milestones) בסוף המסמך — לא הכל בבת אחת.

---

## 1. סקירה כללית

בנה אפליקציית React + TypeScript (Vite) שהיא **מנוע משחק טריוויה מונע-JSON**, המיועדת להקרנה על מסך גדול באירועים חיים. הקהל מצביע דרך מערכת חיצונית קיימת (WebSocket לפי מספר חדר, או קליקרים פיזיים במצב אופליין). המנוע קורא קובץ משחק בפורמט JSON קיים (מוגדר במלואו בסעיף 3) ו"מנגן" אותו: שקופיות, שאלות, הצבעות, ניקוד, מדיה וסאונד — הכל מוגדר ב-JSON.

### עקרונות ארכיטקטורה (מחייבים)

```
game.json → Validator (Zod) → GameEngine (מכונת מצבים טהורה) → Renderer (React)
                                        ↑
                            VoteAdapter (socket / replay / clickers)
```

1. **GameEngine הוא מחלקה טהורה ללא React וללא DOM.** מקבל אירועים (`ADVANCE`, `VOTE_SNAPSHOT`, `TIMER_TICK`...), מחזיק state, פולט state חדש. כל הלוגיקה — ניקוד, מעברים, זוכים — נמצאת בו בלבד.
2. **Renderer הוא שכבת תצוגה בלבד.** מרנדר את ה-state של המנוע. אפס לוגיקה עסקית בקומפוננטות.
3. **VoteAdapter הוא interface אחיד.** המנוע לא יודע מאיפה מגיעות הצבעות:
```typescript
interface VoteAdapter {
  connect(roomId: string): Promise<void>;
  disconnect(): void;
  onVoteSnapshot(cb: (snapshot: VoteSnapshot) => void): void;
  onStatusChange(cb: (status: 'connected' | 'reconnecting' | 'offline') => void): void;
  requestFullState(): Promise<VoteSnapshot>; // לשחזור אחרי ניתוק
}
```
4. **כל מעבר מצב עובר דרך המנוע.** אין `setState` שמשנה לוגיקת משחק ישירות.

---

## 2. סוגי שקופיות (`type`)

| type | תיאור | הצבעה? | ניקוד? |
|---|---|---|---|
| `trivia` | שאלה עם תשובה נכונה (`correct: true` על תשובה אחת) | כן | כן — `scoreForQue` למי שצדק |
| `survey` | סקר/שאלת דיון — אין תשובה נכונה (כל `correct: false`) | כן | אופציונלי — ראה 5.2 |
| `ans_images` | התשובות הן URL של תמונות; מוצגות כגריד תמונות. בקבצים קיימים כולן `correct: true` — משמעות: בחירה חופשית, אין "טעות" | כן | כמו survey |
| `media` | שקופית מדיה בלבד (`openMedia.src`) — וידאו/תמונה/YouTube. אין הצבעה | לא | לא |
| `subject` | שקופית טקסט/כותרת (`que` הוא הטקסט). **חלק מהן פקודות מערכת — ראה סעיף 4** | לא | לא |

מספר התשובות משתנה (3, 4 או 5) — אסור להניח 4. `answers[].id` הוא המזהה שמגיע מההצבעה (`ansIsNumber: true` = המצביע לוחץ ספרה).

---

## 3. סכמת ה-JSON — ולידציה עם Zod

### 3.1 מבנה עליון

```typescript
interface GameFile {
  name: string;
  id: string;                 // UUID — משמש כמפתח cache וגיבוי
  questions: Slide[];         // "שקופיות" — השם ההיסטורי הוא questions
  setting: GlobalSettings;
  assets: AssetEntry[];       // manifest להורדה מראש
  createdAt: string;
  cloudinaryFolder: string;
  credit: string | null;
  users: string;              // JSON-string, בד"כ "{}"
  room: string | null;
  baseUrl: string;
  cloudinaryAbsolutePathImage: string;
  cloudinaryAbsolutePathVideo: string;
}
```

### 3.2 שקופית

```typescript
interface Slide {
  id: number;
  type: 'trivia' | 'survey' | 'ans_images' | 'media' | 'subject';
  question: {
    que: string;
    scoreForQue: number | "";     // ⚠️ ריק = "" ולא null/0
    timeForQue: number | "";      // שניות להצבעה
    answers: { ans: string; correct: boolean; id: number }[];
    src: string;                  // תמונת שאלה (אופציונלי, "")
  };
  openMedia: { src: string };     // מדיה שמנוגנת לפני/עם השאלה
  endMedia: { src: string };      // מדיה בסיום השקופית
  backgroundMedia: { src: string };
  setting: SlideSettings;
}
```

### 3.3 הגדרות פר-שקופית

```typescript
interface SlideSettings {
  allowChangeVote: boolean;        // הצבעה אחרונה גוברת / ראשונה נועלת
  slideStartVoting: boolean;       // ההצבעה נפתחת מיד עם הצגת השקופית
  playAfterClicking: boolean;
  exitGame: boolean;
  correctlyAnsweredBefore: boolean; // רק מי שצדק עד כה רשאי להצביע
  firstClicker: boolean;            // הראשון שלוחץ זוכה (buzzer mode)
  answerIsSequenceClicks: boolean;  // התשובה היא רצף לחיצות
  fullscreen: boolean;
  scoringReduction: { active: boolean; seconds: number | ""; score: number | "" }; // הפחתת ניקוד אחרי X שניות
  slidBackgroundMedia: { src: string };
  automaticSkip: { active: boolean; seconds: number | "" };  // מעבר אוטומטי
  showInLoop: boolean;
}
```

### 3.4 הגדרות גלובליות

```typescript
interface GlobalSettings {
  titleThroughoutGame: string;
  ansIsNumber: boolean;
  multiWinners: number;            // כמה זוכים להציג (1 / 5...)
  showWinnersListAfter: number | null;
  mainColor: string;               // ⚠️ HEX עם אלפא: "#FECC39FF" (8 ספרות) — לתמוך גם ב-6
  secondaryColor: string;
  gameMedia: { src: string };      // רקע מסך פתיחה/התחברות
  logo: { src: string };
  triviaMedia: { src: string };    // רקע שאלות
  winnersListMedia: { src: string };
  winnersMedia: { src: string };
  sound: {                         // 7 ערוצי סאונד, כל אחד { src: string | null }
    playersConnectingMediaSound: { src: string | null };
    showQuestionMediaSound: { src: string | null };
    winnersMediaSound: { src: string | null };
    winnersListMediaSound: { src: string | null };
    genericMediaSound: { src: string | null };
    timerMediaSound: { src: string | null };
    inShowAnsMediaSound: { src: string | null };
  };
  limit: { type: 'phones' | string };
}
```

### 3.5 כללי ולידציה קריטיים

- **שדות מספריים ריקים מגיעים כ-`""`** — הסכמה חייבת `z.union([z.number(), z.literal("")])` עם transform לברירות מחדל (score=0, time=15, וכו'). אסור להפיל קובץ תקין על זה.
- `assets[].type` **לא אמין**: סרטוני YouTube רשומים כ-`"image"`. יש לזהות סוג לפי URL (`youtube.com/embed/` → youtube; סיומת קובץ → image/video/audio), לא לפי השדה.
- מדיה יכולה להיות: תמונה, וידאו (mp4), אודיו (mp3), או **YouTube embed** — נגן iframe נפרד.
- שגיאות ולידציה מוצגות בעברית, עם מיקום מדויק: `"שקופית 7 (id=7): scoreForQue חייב להיות מספר"`.
- הכל **RTL ועברית** — `dir="rtl"` גלובלי, פונטים תומכי עברית.

---

## 4. שקופיות פקודה ("שקופיות קסם") — קריטי

חלק משקופיות ה-`subject` הן פקודות מערכת המזוהות **לפי תבנית התוכן של `que`** (לא לפי id). המנוע חייב לזהות אותן ולהפעיל side effect, לא רק להציג טקסט:

| תבנית `que` | משמעות | התנהגות |
|---|---|---|
| מתחיל ב-`image_URL\n` ואחריו URL | תמונה דינמית מהשרת | להחליף `{{GAMA_ID}}` ב-id של המשחק/סשן ולהציג את התמונה במסך מלא. אם הטעינה נכשלת — retry עם backoff + הודעת המתנה |
| `que === "Send_data"` | טריגר שליחת תוצאות | שליחת snapshot מלא (סעיף 7) למערכת החיצונית. להציג מסך ביניים ניטרלי ("מעבד נתונים...") עד אישור |

כל שאר שקופיות ה-`subject` (כולל שקופיות "סגרו את הכרטיסיה" וכדומה) הן **טקסט לתצוגה בלבד** — אין להן שום side effect.

חובה לממש את הזיהוי כ-`classifySubjectSlide(que): 'dynamic-image' | 'send-data' | 'plain'` עם בדיקות יחידה על הדוגמאות האמיתיות.

---

## 5. זרימת שקופית וניקוד

### 5.1 מחזור חיים של שקופית שאלה (trivia/survey/ans_images)

```
ENTER → [openMedia אם קיים] → SHOW_QUESTION (+סאונד showQuestion)
      → VOTING_OPEN (אם slideStartVoting=true נפתח מיד)
      → טיימר timeForQue יורד (+סאונד timer) → VOTING_CLOSED
      → SHOW_RESULTS (התפלגות; ב-trivia: הדגשת התשובה הנכונה +סאונד inShowAns)
      → [endMedia אם קיים] → ממתין ל-ADVANCE (או automaticSkip)
```

- **שליטת מפעיל:** מקש רווח / חץ / קליק = ADVANCE. מקש אחורה = חזרה (עם אישור). ESC = תפריט מפעיל.
- `media` ו-`subject`: תצוגה בלבד, ממתין ל-ADVANCE (או automaticSkip).

### 5.2 ניקוד

- `trivia`: כל מצביע שבחר בתשובה `correct: true` בתוך החלון מקבל `scoreForQue`.
- `scoringReduction.active`: אחרי `seconds` שניות, הניקוד יורד ל-`score`.
- `firstClicker`: רק המצביע הראשון (לפי חותמת השרת/הרצף) מקבל ניקוד.
- `correctlyAnsweredBefore`: מסנן — רק מי שצדק בכל שאלות ה-trivia הקודמות משתתף.
- `survey` / `ans_images`: אם `scoreForQue` מוגדר — נקודות השתתפות לכל מצביע (ברירת מחדל: בלי ניקוד; להשאיר את זה מאחורי קונפיג).
- טבלת ניקוד נצברת פר `voterId`. מסך זוכים מציג `multiWinners` מובילים, עם מדיה + סאונד winners מההגדרות.

---

## 6. קליטת הצבעות — עומס גבוה ואמינות

- הקליינט **לעולם לא מקבל הצבעות בודדות**. השרת הקיים (מחוץ ל-scope) שולח snapshot מצטבר כל ~250ms:
```typescript
interface VoteSnapshot {
  seq: number;                       // מספר רץ
  slideId: number;
  counts: Record<string, number>;    // answerId → מספר הצבעות
  total: number;
  voters?: Record<string, number>;   // voterId → answerId (לניקוד; יכול להגיע רק בסגירת חלון)
  firstVoter?: string;               // ל-firstClicker
}
```
- **SocketAdapter**: התחברות לערוץ לפי `roomId`. reconnect אוטומטי עם exponential backoff (1s→2s→4s→מקס 10s, בלי הגבלת ניסיונות). אחרי reconnect — `requestFullState()` מיידי ליישור מצב.
- **זיהוי פערים:** אם `seq` לא רציף — לבקש full state. אין להצטבר על delta חסר.
- **Heartbeat**: ping כל 5 שניות. אין תשובה ל-2 פינגים → נורית סטטוס צהובה/אדומה קטנה בפינת המסך (למפעיל בלבד, לא שוברת את חוויית הקהל).
- **ReplayAdapter** (לפיתוח ובדיקות): מזרים snapshots מוקלטים/מסונתזים מקובץ, כולל סימולציית 5,000 הצבעות בחלון של 15 שניות — כדי לוודא שהרינדור חלק (עדכון תצוגת מונים ב-requestAnimationFrame, לא על כל snapshot).

---

## 7. גיבוי ושחזור (Resume)

### 7.1 Snapshot מצב מלא

המנוע חושף `serialize(): GameSnapshot` ו-`restore(s: GameSnapshot)`:

```typescript
interface GameSnapshot {
  version: 1;
  gameId: string;
  roomId: string | null;
  seq: number;                       // אינקרמנט בכל שמירה
  savedAt: string;                   // ISO
  currentSlideId: number;
  phase: 'showing' | 'voting' | 'results' | 'ended';
  scores: Record<string, number>;    // voterId → ניקוד מצטבר
  votesBySlide: Record<number, Record<string, number>>; // slideId → voterId → answerId
  slidesCompleted: number[];
  firstClickWinners: Record<number, string>;
}
```

### 7.2 מתי שומרים

בכל **מעבר מצב** (מעבר שקופית, סגירת חלון הצבעה, חישוב תוצאות) — לא בכל הצבעה. Debounce של 500ms על שמירות רצופות.

### 7.3 יעדי שמירה (interface אחד, שני מימושים)

```typescript
interface BackupTarget {
  save(s: GameSnapshot): Promise<void>;
  load(gameId: string): Promise<GameSnapshot | null>;
  clear(gameId: string): Promise<void>;
}
```

- **OnlineBackupTarget:** `POST /backup/{gameId}` למערכת החיצונית (URL בקונפיג). כשל שמירה ≠ עצירת משחק: תור שמירות בזיכרון + retry ברקע, ואינדיקציה שקטה למפעיל. בנוסף — **תמיד** שמירה מקבילה ל-IndexedDB מקומי כרשת ביטחון.
- **OfflineBackupTarget:** כתיבת `resume.json` בתיקיית המשחק. **כתיבה אטומית:** קודם `resume.json.tmp`, ואז rename. לעולם לא לכתוב ישירות על הקובץ הקיים.

### 7.4 זרימת פתיחת משחק

1. טעינת JSON ← ולידציה.
2. `load(gameId)` מול יעד הגיבוי (אונליין: המערכת החיצונית; במקביל בדיקת IndexedDB — הגרסה עם `seq` הגבוה גוברת).
3. אם קיים snapshot עם `slidesCompleted` לא ריק ו-`phase !== 'ended'` → דיאלוג:
   **"נמצא משחק שהופסק בשקופית X מתוך Y (נשמר ב-HH:MM). להמשיך מאותה נקודה או להתחיל מחדש?"**
4. המשך → `restore(snapshot)`. התחלה מחדש → `clear(gameId)` ואישור כפול.

---

## 8. Preload — טעינה מדורגת לחיבור חלש

**עיקרון: לא חוסמים את תחילת המשחק על הורדת הכל.**

1. **שלב חוסם (מסך טעינה עם progress):** נכסי מערכת בלבד (gameMedia, logo, triviaMedia, winners*, 7 סאונדים) + נכסי 5 השקופיות הראשונות. בקבצים האמיתיים זה 5–10 קבצים.
2. **תור רקע:** הורדת שאר הנכסים לפי סדר השקופיות, עם עדיפות דינמית — תמיד לוודא שהנכסים של N+3 השקופיות הבאות מהמיקום הנוכחי בראש התור.
3. **אחסון:** Cache API (`caches.open('game-' + gameId)`). הרצה חוזרת של אותו משחק = טעינה מיידית מהדיסק. כפתור "נקה מטמון" בתפריט המפעיל.
4. **תצוגת מפעיל:** פס קטן "הורדו 41/58 נכסים". אם המשחק מגיע לשקופית שנכסיה לא ירדו — spinner על המדיה + המשך הורדה בעדיפות מקסימלית, בלי לקרוס.
5. **YouTube:** אי אפשר לעשות preload ל-embed. בסיום הולידציה להציג למפעיל: **"משחק זה מכיל X סרטוני YouTube הדורשים חיבור אינטרנט פעיל בזמן ההקרנה"** + רשימתם. במצב אופליין (ZIP) — שקופית YouTube מציגה placeholder עם אזהרה.
6. **מצב אופליין (ZIP):** קובץ ZIP המכיל `game.json` + תיקיית `media/`. ה-JSON באופליין מפנה לנתיבים יחסיים (`media/xxx.jpg`) או שהטוען ממפה URL→קובץ לפי `assets[].name`. פריסה: קריאת ה-ZIP עם JSZip, טעינת קבצים כ-Blob URLs.

---

## 9. UI ועיצוב

- **מסכים:** טעינה (progress) → מסך פתיחה/התחברות (gameMedia + סאונד playersConnecting + מונה מחוברים אם זמין) → שקופיות המשחק → זוכים (winnersMedia) → רשימת זוכים (winnersListMedia).
- צבעים מ-`mainColor`/`secondaryColor` (כולל אלפא 8 ספרות) כ-CSS variables.
- טיפוגרפיה גדולה לקריאה ממרחק (שאלה ≥ 48px על מסך מלא), אנימציות מעבר עדינות, ברים של התפלגות הצבעות מתעדכנים חלק.
- טיימר עיגול/בר בולט + סאונד טיימר.
- `ans_images`: גריד 2x2 (או 3/5 בהתאם), מספר גדול על כל תמונה (כי `ansIsNumber`).
- ערוצי סאונד: מנוהלים ב-AudioManager אחד — סאונד חדש עוצר את הקודם באותו ערוץ; ווליום מפעיל; autoplay נפתח רק אחרי אינטראקציה ראשונה (מגבלת דפדפן).
- תפריט מפעיל (ESC): קפיצה לשקופית, נעילת/פתיחת הצבעה ידנית, סטטוס חיבור, סטטוס הורדות, ניקוי מטמון, סיום משחק.

---

## 10. אבני דרך לבנייה (לפי הסדר!)

**M1 — ליבה:** סכמת Zod מלאה + טעינת JSON + `classifySubjectSlide` + GameEngine עם כל המעברים + בדיקות יחידה על 4 קבצי המשחק האמיתיים (יסופקו). בלי UI כמעט — מסך דיבאג שמציג את ה-state.

**M2 — רנדרר:** כל סוגי השקופיות, RTL, צבעים, סאונד, טיימר, מסכי זוכים. ReplayAdapter מדומה כמקור הצבעות. בשלב הזה המשחק שלם וניתן להרצה מלאה בלי שרת.

**M3 — רשת:** SocketAdapter מול הפרוטוקול הקיים (יסופק בנפרד: כתובת, פורמט הודעות, ערוץ לפי roomId), reconnect, seq, heartbeat, נורית סטטוס.

**M4 — עמידות:** Preload מדורג + Cache API + snapshot/restore + OnlineBackupTarget + IndexedDB fallback + דיאלוג "המשך משחק".

**M5 — אופליין:** טעינת ZIP, מיפוי נכסים מקומיים, OfflineBackupTarget עם כתיבה אטומית, placeholder ל-YouTube.

**כללי עבודה:** TypeScript strict; אסור `any` בלוגיקת המנוע; כל פונקציית ניקוד/מעבר עם בדיקת יחידה; אין ספריות state כבדות — המנוע עצמו הוא ה-store (useSyncExternalStore לחיבור ל-React).

---

## 11. מה יסופק בנפרד (אל תמציא)

- פרוטוקול ה-WebSocket המדויק של מערכת ההצבעות הקיימת (פורמט הודעות, אימות, כתובת).
- API של מערכת הגיבוי החיצונית (endpoints מדויקים).
- 4 קבצי JSON אמיתיים לבדיקות.

עד אז — לעבוד מול Mock/Replay בלבד, מאחורי ה-interfaces שהוגדרו לעיל.
