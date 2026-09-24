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
| `ans_images` | התשובות הן URL של תמונות; מוצגות כגריד תמונות. מערכת יצירת המשחקים שולחת תשובה נכונה אחת (`correct: true`) ואת השאר `false`; בקבצים ישנים כולן `correct: true` — בחירה חופשית, אין "טעות" | כן | כשסומנה תשובה נכונה (לפחות אחת `true` ואחת `false`) — כמו trivia; אחרת כמו survey |
| `media` | שקופית מדיה בלבד (`openMedia.src`) — וידאו/תמונה/YouTube. אין הצבעה | לא | לא |
| `subject` | שקופית טקסט/כותרת (`que` הוא הטקסט). **חלק מהן פקודות מערכת — ראה סעיף 4** | לא | לא |
| `bet` | **הימור** על השאלה המנוקדת הבאה: הכרטיסים הם אפשרויות הימור (`bet.options`, באותו סדר כמו `answers`), בלי תשובה נכונה. ראה 5.3 | כן | לא ישירות — ההימור מוכרע בשאלה הבאה |

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
  descendingScore?: { active: boolean; maxScore: number | "" }; // ניקוד יורד: צולל מ-maxScore לאפס לאורך timeForQue; חסר = כבוי, "" = 1000
  imageReveal?: { active: boolean; blur: number | "" }; // תמונת השאלה מטושטשת ב-blur px לפני ההצבעה, מתבהרת לאורך timeForQue, חדה בסגירה; חסר = כבוי, "" = 48
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
  voterNameStyle?: 'plain' | 'bubble'; // השם שמתעופף בצד עם כל הצבעה: על הרקע (ברירת מחדל) או בבועת דיבור
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
- `descendingScore.active`: **ניקוד יורד** — הניקוד צולל ברציפות (לא במדרגות) מ-`maxScore`
  לאפס לאורך `timeForQue` (1000 על 10 שניות = 100 לשנייה), ומי שצדק מקבל את הערך שהיה
  על המסך ברגע הלחיצה. הזמן הוא הזמן האפקטיבי מפתיחת ההצבעה בלי עצירות מנחה (ה-host
  מזריק `elapsedMs` ב-`VOTE_SNAPSHOT`; בלעדיו — `at − openedAt`; בלי שניהם — מקסימום).
  הוספת/החסרת שניות לטיימר אינה משנה את הקצב. מחליף את `scoreForQue` ואת
  `scoringReduction`. הנוסחה והתצוגה החיה בשקופית חולקות את `scoring.ts`.
- `firstClicker`: רק המצביע הראשון (לפי חותמת השרת/הרצף) מקבל ניקוד.
- `majorityDecides` («הרוב קובע»): אין תשובה נכונה מראש — `correct` בכל התשובות `false` (וכל
  סימון שהגיע בקובץ מתאפס בטעינה). בסגירת ההצבעה התשובה שקיבלה הכי הרבה קולות נעשית
  הנכונה (בתיקו — כל התשובות שבראש; בלי הצבעות — אף אחת), ההכרעה נכתבת אל דגלי `correct`
  של השקופית, ומכאן הניקוד, החשיפה, «ענו נכון קודם», ההימור, הגיבוי והדוח רגילים. ההכרעה
  נשמרת ב-`majorityBySlide` (snapshot/גיבוי) ומוחלת מחדש אחרי שחזור ורענון תוכן. ראו majority.ts.
- `liveVoteCounts`: תצוגה בלבד — בזמן ההצבעה מוצג ליד כל תשובה כמה בחרו בה ואחוז
  («אפקט העדר»). אינו משנה ניקוד.
- `correctlyAnsweredBefore`: מסנן — רק מי שצדק בכל שאלות ה-trivia הקודמות משתתף.
- `ans_images` שסומנה בה תשובה נכונה (לפחות אחת `correct: true` ואחת `false`) — מנוקדת
  **כמו trivia**: הבוחר בתמונה הנכונה מקבל `scoreForQue` (או את הניקוד היורד).
- `survey` / `ans_images` בלי סימון כזה: אם `scoreForQue` מוגדר — נקודות השתתפות לכל מצביע (ברירת מחדל: בלי ניקוד; להשאיר את זה מאחורי קונפיג).
- טבלת ניקוד נצברת פר `voterId`. מסך זוכים מציג `multiWinners` מובילים, עם מדיה + סאונד winners מההגדרות.

### 5.3 שקופית הימור (`type: "bet"`)

שקופית הצבעה שבה הכרטיסים הם **אפשרויות הימור** על השאלה המנוקדת הבאה. `question.answers`
הם הכיתובים על הכרטיסים (וכפתורי ההצבעה 1..N, כמו בסקר), ו-`bet.options` — באותו סדר —
המשמעות של כל כרטיס:

```json
"bet": {
  "options": [
    { "kind": "none" },
    { "kind": "percent", "value": 25 },
    { "kind": "percent", "value": 50 },
    { "kind": "all", "payout": 2 }
  ],
  "payout": 1,
  "allowNegative": false
}
```

- `kind`: `none` (בלי הימור) · `percent` (`value` = אחוז מהניקוד) · `fixed` (`value` = נקודות,
  גם למי שבלי נקודות) · `all` (כל הניקוד). `payout` = מכפיל הזכייה (1 = כפול או כלום),
  ניתן לדריסה לכל אפשרות. `allowNegative` מבטל את רצפת האפס.
- קונפיג חסר או קצר מושלם ב-`none`; ארוך מדי נקצץ. `scoreForQue` הוא `""`/0 — ההימור אינו מנוקד.
- **סגירת ההימור** (`closeVoting`): לכל מצביע נרשם `stake` לפי האפשרות שבחר והניקוד שלו
  **באותו רגע** (`betStakes[betSlideId][voterId]`; מי שבחר `none` או שאין לו נקודות אינו
  ברשימה). אין ניקוד, אין זמן תגובה.
- **ההכרעה** — בשקופית המנוקדת «כמו טריוויה» הקרובה אחריה, בלי שאלה מנוקדת ביניהן (טקסט,
  מדיה, פונקציה וסקר מדולגים; שני הימורים ברצף — הקרוב לשאלה קובע; הימור בלי שאלה אחריו —
  בטל). נכון (התשובה שנבחרה `correct`, בלי קשר לניקוד שהשאלה נתנה) → `+stake × payout`;
  טעה או לא ענה → `−stake`, ולא מתחת לאפס. התוצאה ב-`betOutcomes[slideId][voterId]`
  (`{stake, won, delta, answerId}`), ה-delta מקוזז בדיוק בחזרה על השאלה.
- חזרה על שקופית ההימור מחשבת הימורים מחדש מהניקוד הנוכחי. `resetScores` מבטל הימורים
  פתוחים; `removeVoters` מוחק את המוסרים מהרשימות. הכול נשמר ב-snapshot ובגיבוי (`meta`).
- ה-host: אחרי חשיפת התשובה בשאלה שהכריעה הימור, הרווח הבא פותח את מסך «תוצאות ההימור»
  (זכו / הפסידו / ההימור הגדול) פעם אחת; רווח נוסף ממשיך. ההימור אינו נספר כ«שאלה» לטבלת
  המובילים האוטומטית, ומקבל גליון משלו בדוח. הלוגיקה כולה ב-bet.ts.

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
- **חשיפה הדרגתית של תמונת השאלה** (`setting.imageReveal`): לפני ההצבעה התמונה (לצד הטקסט או במקומו) מטושטשת ב-`blur` פיקסלים; עם פתיחת הטיימר הטשטוש יורד ברציפות בכל פריים לפי אותו שעון של הניקוד היורד (עצירת מנחה מקפיאה, הארכה לא משנה את הקצב), וכשההצבעה נסגרת התמונה חדה. `imageReveal.ts` + `RevealImage` ב-QuestionSlide.
- צבעים מ-`mainColor`/`secondaryColor` (כולל אלפא 8 ספרות) כ-CSS variables.
- טיפוגרפיה גדולה לקריאה ממרחק (שאלה ≥ 48px על מסך מלא), אנימציות מעבר עדינות, ברים של התפלגות הצבעות מתעדכנים חלק.
- טיימר עיגול/בר בולט + סאונד טיימר.
- `ans_images`: גריד 2x2 (או 3/5 בהתאם), מספר גדול על כל תמונה (כי `ansIsNumber`).
- ערוצי סאונד: מנוהלים ב-AudioManager אחד — סאונד חדש עוצר את הקודם באותו ערוץ; ווליום מפעיל; autoplay נפתח רק אחרי אינטראקציה ראשונה (מגבלת דפדפן).
- תפריט מפעיל (ESC): קפיצה לשקופית, נעילת/פתיחת הצבעה ידנית, סטטוס חיבור, סטטוס הורדות, ניקוי מטמון, סיום משחק.

### 9.1 קריינות אוטומטית (`setting.narration`)

קריין מלאכותי שמלווה את מהלך המשחק בקטעי MP3 **מוכנים מראש** שמערכת יצירת המשחקים
מייצרת. החוזה המלא: `ENGINE-narration.md`. **קובץ בלי `narration` מתנהג בדיוק כמו
היום** — כל השדות אופציונליים, וקובץ פגום בשדה הזה נטען כאילו אין בו קריינות.

```json
"setting": {
  "narration": {
    "enabled": true, "voice": "kore", "announceQuestionNumber": true,
    "duck": false, "bankVersion": 1,
    "bank": { "num_f_1": "https://…/tts/ab/….mp3", "flow_question_number": "…" }
  }
},
"questions": [
  { "narration": { "question": "…mp3", "answers": ["…mp3", null], "correct": null } }
]
```

- `bank` — מילון `bank_key → url` של הביטויים הקבועים של הקול. **מפתח חסר מדולג בשקט.**
- `groups` — מילון `שם הקבוצה בדיוק כמו במרשם → url` לקטעי שמות הקבוצות (הם משתנים
  ממשחק למשחק ולכן אינם בבנק). שם חסר = הקריין אומר את הביטוי הכללי בלי השם.
- `questions[i].narration` — קטע לשאלה, קטע לכל תשובה **באותו סדר כמו `answers`**
  (`null` כשאין טקסט, למשל תשובות-תמונה), ו-`correct` (בדרך כלל `null`). באופליין אותם
  שדות עם נתיבים יחסיים (`Assets/nar-….mp3`), והקבצים נכנסים ל-ZIP כמו כל מדיה.
- **הקטעים אינם מדיית משחק.** הם מסומנים `kind: 'narration'` ב-`mediaFields`, ולכן
  `orderedMediaUrls` (הטעינה המוקדמת שמעכבת את כפתור ההתחלה) ובדיקת הקישורים השבורים
  מדלגות עליהם — מסך הטעינה של משחק ותיק אינו משתנה. הצרכן היחיד שרואה אותם הוא
  `zipLoader`, למיפוי הנתיבים היחסיים; קטע שחסר ב-ZIP אינו «נכס חסר» אלא מדולג בשקט.
  `NarrationPlayer.preload` מושך את הבנק ואת השקופית הבאה ברקע, בלי לחסום.

**שלושת הכללים:**

1. **שכבה נפרדת.** `NarrationPlayer` (Web Audio, `src/app/narration/`) — לא עובר דרך
   `AudioManager`, ולכן אינו עוצר סאונד קיים ואינו נעצר על ידו. רק `duck: true` מנמיך
   זמנית את ווליום המשחק ל-25% בזמן שהקריין מדבר.
2. **נגררת אחרי המסך.** כל שינוי במצב המוצג מבטל מיד את הקטע שמתנגן ומתחיל את הקטע
   של המצב החדש. מדיה חוסמת או שכבה שאינה מוקראת (תפריט, הגדרות, שמות, לובי, הגרלה,
   פירוט הצבעות, לוח) = שקט מוחלט.
3. **לא חוזרת על עצמה ולא חוסמת.** בתוך ביקור בשקופית כל אירוע מוקרא פעם אחת (צעד
   אחורה וקדימה לא מקריא שוב); קטע שלא נטען מדולג והמשחק ממשיך; **אין יצירת שמע בזמן
   משחק** — מספרים מורכבים מקטעי הבנק (`hebrewNumber.ts`: אלפים → מאות → עשרות/יחידות,
   ו׳ החיבור על החלק האחרון בלבד).

**מה מוקרא מתי** (`narrationDirector.ts`, טהור ונבדק ביחידה):

| מה מוצג | קטעים |
|---|---|
| מסך פתיחה (פעם אחת למשחק) | `flow_welcome` |
| השאלה מוצגת | [`flow_question_number` + מספר בנקבה] + `narration.question` |
| שקופית הימור מוצגת | `bet_round` + `narration.question` |
| תשובה k נחשפה | `flow_answer_number` + k + `narration.answers[k-1]` |
| ההצבעה נפתחה | `flow_vote_open` |
| נשארו 10 שניות (כשהזמן הכולל ≥ 20) | `timer_ten_left` (פעם אחת לכל חלון הצבעה) |
| עצירה / המשך של המנחה | `timer_paused` / `timer_resumed` |
| ההצבעה נסגרה | `timer_times_up`; בהימור `bet_closed` |
| התשובה הנכונה נחשפה | `score_correct_is` (רבות: `score_correct_multi`) + קטעי התשובות; תשובה בלי קטע — `flow_answer_number` + מספרה אחרי הפתיח, ובתשובה יחידה בלי קטע `score_correct_number` + מספרה **במקום** הפתיח (אחרת «התשובה הנכונה היא» נאמר פעמיים); «הרוב קובע»: `misc_majority`; סקר: `misc_poll_results`; הימור: כלום |
| מסך תוצאות ההימור | `bet_results`; כשמישהו זכה — `bet_biggest` + הזכייה הגדולה (המספר שמתחת ל«ההימור הגדול» במסך, בלי השם) + `unit_points` |
| לוח מובילים (מקש 1) | `lb_title` + לשלושת הראשונים `lb_place_n` + ניקוד |
| מסך מנצחים | בכניסה `lb_winners`; כל חשיפת מקום 1–3 (מהאחרון לראשון) `lb_place_r` + ניקוד, ובמקום הראשון `lb_winner` לפניו |
| לוח ניקוד מלא | `lb_title` + `flow_thanks` |
| תצוגה מקדימה של המנצחים (W) | שקט מוחלט — הצצה אינה סוף המשחק, והזיכרון אינו נצרך |
| פונקציה: איפוס ניקוד | `score_reset` |
| פונקציה: הישרדות | `surv_round`, ואחרי ההסרה `surv_remaining` + מספר בזכר + `unit_participants` |

**קריאות אווירה (`amb_*`)** — ENGINE-narration.md 1.1–1.2. מעל הקריאות העובדתיות יושבת
קבוצת אווירה: לכל מצב כמה ניסוחים חלופיים, ו-`ambience.ts` מסובב ביניהם **בלי
Math.random** (מונה לכל מצב בזיכרון הבמאי), כך שאותו ניסוח לא נשמע פעמיים ברצף.
**מפתח שאינו בבנק של המשחק מדולג** — משחק שנוצר לפני הרחבת הבנק פשוט שקט יותר,
וזה בדיוק מה שבודקות בדיקות הבמאי (הבנק שלהן אינו מכיר `amb_*` והפלט העובדתי
בהן לא השתנה). שורת `_pre` היא כול-או-כלום **לשני הכיוונים**: בלי הפתיח גם המספר/השם
שאחריו נופל (אחרת נשמע מספר ערום), ובלי אף קטע בזנב נופל גם הפתיח (אחרת נשמע
«ההפרש הוא» ושקט).

| מה מוצג | קריאת האווירה |
|---|---|
| מסך התחברות, כל ~45 שניות | `amb_lobby_*` לסירוגין; כל פעם שלישית `amb_connected_pre` + מספר המחוברים בזכר + `unit_participants` |
| יציאה ממסך הפתיחה למשחק (פעם אחת) | `amb_start_*` |
| כניסה לשאלה שאינה הראשונה | `amb_next_*` **לפני** מספר השאלה, באותו משפט; בשאלה שחוצה את החצי (ורק ממשחק של 6 שאלות ומעלה, פעם אחת) `amb_half`; בשאלה האחרונה `amb_last_question` — כל אחד מהם **במקום** `amb_next_*`. שלושתם אירוע אחד (`questionAmbience`) ולכן **קריאה אחת לכל ביקור בשקופית**, גם כשהניסוח מתחלף באמצע |
| חלף חצי מזמן ההצבעה | `amb_voting_*` (פעם אחת לחלון) |
| שתי השניות האחרונות | `amb_hurry`; כשהוא נופל על אותו צעד עם `timer_ten_left` — «עשר שניות» מנצח ו-`amb_hurry` נופל |
| חשיפת התשובה הנכונה | אחרי המשפט העובדתי: כולם צדקו `amb_all_correct_*` · אף אחד `amb_none_correct_*` · יותר משני שלישים `amb_most_correct` · פחות מחמישית `amb_few_correct` (לכל תוצאה מונה ניסוחים משלה). שקט כשהמספרים לא ידועים, בסקר, בהימור, ב«הרוב קובע» **וכששקופית ההצבעה אינה מסמנת תשובה נכונה כלל** (תשובה-בתמונה שאינה מנוקדת — שם גם המשפט העובדתי שותק) |
| לוח מובילים | אחרי הפודיום: `amb_lead_change` (המוביל התחלף מאז ההכרזה הקודמת) · `amb_tie_top` (תיקו בראש) · אחרת `amb_lead_gap_pre` + ההפרש המעוגל + `unit_points`. שני האחרונים דורשים **שני** מובילים ברשימה — עם צובר ניקוד יחיד אין «הפרש בין הראשון לשני» |
| מסך הקבוצות | לפי הסדר: `amb_group_close` כשההפרש **מתעגל לאפס** (תיקו במספרים שעל המסך, כמו `amb_tie_top`) · `amb_group_lead_pre` + קטע שם הקבוצה המובילה · `amb_group_gap_pre` + ההפרש · ובלית ברירה (קבוצה יחידה בלי קטע שם) `amb_group_close` — `amb_group_lead_pre` לבדו הוא חצי משפט |
| מסך המנצחים | בכניסה `amb_winners_intro` לפני `lb_winners`; `amb_drumroll` לפני כל חשיפה; `amb_congrats` אחרי המקום הראשון |
| הימור | `amb_bet_brave` בפתיחת ההצבעה; בתוצאות `amb_bet_none` (איש לא הימר) · `amb_bet_big_win` / `amb_bet_big_loss` כשהתוצאה הגדולה היא לפחות חצי מניקוד המוביל |
| הישרדות · הגרלה · לוח הסולמות | `amb_surv_tension` לפני `surv_round` ו-`amb_surv_relief` אחרי `surv_remaining` · `amb_raffle_*` · `amb_board_climb` / `amb_board_fall` / `amb_board_move` |

כל אלה כפופים לאותם שלושה כללים: מתבטלות עם שינוי המסך, פעם אחת לכל ביקור בשקופית
(קריאות חלון ההצבעה מתאפסות עם כל פתיחת הצבעה), ושקט מוחלט מעל מדיה חוסמת, מעל שכבה
שאינה מוקראת וכשהקריינות מושתקת. הקלטים כולם מחושבים ב-`GameHost` ומועברים ב-
`DisplayedState` — הבמאי נשאר טהור. שעון הלובי (`lobbyElapsedMs`) נדגם כל 5 שניות
**רק** כל עוד מסך הפתיחה מוצג והקריינות פעילה, ואינו נכנס לחתימת המצב (אחרת דגימה
הייתה מבטלת את מה שמתנגן).

מעבר אוטומטי (`autoTransition`) **ממתין לסיום המשפט** כשהקריין מדבר, כדי לא לחתוך אותו
באמצע; לחיצת מנחה עדיין מקדמת מיד. בתפריט המפעיל (ESC) יש מתג «קריינות» וווליום נפרד
(נשמרים ב-localStorage) — ההשתקה אינה נוגעת בסאונד המשחק.

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
