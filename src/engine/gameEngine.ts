/**
 * GameEngine — מכונת המצבים של המשחק (SPEC סעיפים 1, 5, 7).
 *
 * מחלקה טהורה: בלי React, בלי DOM, בלי טיימרים. זמן מוזרק מבחוץ דרך השדה
 * `at` שעל האירועים (ל-scoringReduction) ודרך VOTING_TIMEOUT (סגירת חלון
 * ההצבעה). ה-host אחראי להריץ את הטיימרים ולבצע side effects של שקופיות
 * פקודה (subjectCommand) — המנוע רק חושף אותם ב-state.
 *
 * מחזור חיים של שקופית — כל שלב מתקדם ב-ADVANCE מפורש של המפעיל/המנחה
 * (המפרט 5.1 בהתאמה לזרימת שלבים ידנית):
 *   ENTER → ADVANCE מנגן openMedia (אם יש) → ADVANCE פותח הצבעה (בשקופית
 *   הצבעה; ה-host קובע מתי אחרי חשיפת התשובות) → VOTING_TIMEOUT/ADVANCE
 *   סוגר → תוצאות → ADVANCE מנגן endMedia (אם יש) → ADVANCE לשקופית הבאה.
 *
 * כלל ADVANCE: כשמדיה חוסמת מתנגנת — ADVANCE מדלג עליה בלבד. שום דבר לא
 * מתנגן/נפתח אוטומטית בכניסה לשקופית — הצגת מדיה ופתיחת הצבעה הן שלבים.
 */

import { classifySubjectSlide, extractDynamicImageUrl } from './classify.ts';
import { isVotableSlide, type GameFile, type Slide } from './schema.ts';
import type {
  EngineOptions,
  GameEvent,
  GamePhase,
  GameSnapshot,
  GameState,
  SubjectCommand,
  VoteSnapshot,
} from './types.ts';

interface VotingBookkeeping {
  /** הזמן (ms, מוזרק) שבו נפתח חלון ההצבעה — null אם לא סופק. */
  openedAt: number | null;
  /** voterId → הזמן שבו הצבעתו נראתה לראשונה (ל-scoringReduction). */
  firstSeenAt: Record<string, number>;
  /** allowChangeVote=false: ההצבעה הראשונה של כל מצביע ננעלת. */
  lockedVotes: Record<string, number>;
  /** מפת המצביעים האחרונה שהתקבלה (voterId → answerId). */
  latestVoters: Record<string, number> | null;
  /** ה-firstVoter האחרון שדווח (ל-firstClicker). */
  latestFirstVoter: string | null;
  /** seq אחרון שעובד — snapshots ישנים/כפולים נזרקים. */
  lastSeq: number;
}

function freshBookkeeping(): VotingBookkeeping {
  return {
    openedAt: null,
    firstSeenAt: {},
    lockedVotes: {},
    latestVoters: null,
    latestFirstVoter: null,
    lastSeq: Number.NEGATIVE_INFINITY,
  };
}

/**
 * מוני הצבעות (answerId → כמות) ממפת מצביעים (voterId → answerId).
 * המקור היחיד לחישוב הזה — משמש גם את המנוע, את צוברי ההצבעות (סוקט/דמו)
 * ואת סינון הרישיון ב-host, כדי שלא יהיו ארבע גרסאות שסוטות זו מזו.
 */
export function countsOfVotes(votes: Record<string, number>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const answerId of Object.values(votes)) {
    counts[String(answerId)] = (counts[String(answerId)] ?? 0) + 1;
  }
  return counts;
}

export class GameEngine {
  private game: GameFile;
  private readonly surveyParticipationScoring: boolean;
  private roomId: string | null;

  private state: GameState;
  private readonly listeners = new Set<() => void>();

  private voting: VotingBookkeeping = freshBookkeeping();
  /** ניקוד שהוענק פר שקופית — מאפשר חישוב מחדש כשחוזרים לשקופית. */
  private awardedBySlide: Record<number, Record<string, number>> = {};
  /** זמן תגובה (ms) פר שקופית — voterId → latency; מאפשר חישוב מחדש הפיך. */
  private timeBySlide: Record<number, Record<string, number>> = {};
  private saveSeq = 0;

  constructor(game: GameFile, options: EngineOptions = {}) {
    this.game = game;
    this.surveyParticipationScoring = options.surveyParticipationScoring ?? false;
    this.roomId = options.roomId ?? null;
    this.state = this.enterSlideState(0, {
      scores: {},
      answerTimes: {},
      votesBySlide: {},
      slidesCompleted: [],
      firstClickWinners: {},
    });
  }

  // -------------------------------------------------------------------------
  // API ציבורי
  // -------------------------------------------------------------------------

  getState(): GameState {
    return this.state;
  }

  getGame(): GameFile {
    return this.game;
  }

  getCurrentSlide(): Slide {
    const slide = this.game.questions[this.state.currentSlideIndex];
    if (!slide) {
      throw new Error(`שקופית באינדקס ${this.state.currentSlideIndex} אינה קיימת`);
    }
    return slide;
  }

  /**
   * האם מותר לשנות הצבעה בשקופית נתונה (ההצבעה האחרונה קובעת). ההגדרה הגלובלית
   * (game.setting.allowChangeVote) חלה על *כל* המשחק ומפעילה מעל הכל; אחרת נופלים
   * להגדרה הפר-שקופית (slide.setting.allowChangeVote). כך שני המנגנונים חיים יחד.
   */
  private allowChangeVoteFor(slide: Slide): boolean {
    return this.game.setting.allowChangeVote || slide.setting.allowChangeVote;
  }

  /** זמן התגובה הממוצע (ms) של מצביע — נמוך = מהיר. אין תשובות → Infinity. */
  averageResponseMs(voterId: string): number {
    const t = this.state.answerTimes[voterId];
    return t && t.count > 0 ? t.totalMs / t.count : Number.POSITIVE_INFINITY;
  }

  /**
   * מובילי טבלת הניקוד, ממוינים יורד. שובר-שוויון: כשהניקוד זהה בדיוק, המהיר
   * יותר (זמן תגובה ממוצע נמוך) מדורג גבוה יותר; ואז לפי המזהה ליציבות.
   */
  getWinners(limit: number = this.game.setting.multiWinners): { voterId: string; score: number }[] {
    return Object.entries(this.state.scores)
      .map(([voterId, score]) => ({ voterId, score }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          this.averageResponseMs(a.voterId) - this.averageResponseMs(b.voterId) ||
          a.voterId.localeCompare(b.voterId),
      )
      .slice(0, Math.max(0, limit));
  }

  /** מנגנון subscribe לחיבור עתידי ל-React דרך useSyncExternalStore. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(event: GameEvent): void {
    switch (event.type) {
      case 'ADVANCE':
        this.handleAdvance(event.at);
        break;
      case 'BACK':
        this.handleBack(event.at);
        break;
      case 'GOTO':
        this.handleGoto(event.slideId, event.at);
        break;
      case 'VOTE_SNAPSHOT':
        this.handleVoteSnapshot(event.snapshot, event.at);
        break;
      case 'VOTING_TIMEOUT':
        if (this.state.phase === 'voting') this.closeVoting();
        break;
      case 'MEDIA_ENDED':
        this.handleMediaEnded(event.at);
        break;
      case 'OPEN_VOTING':
        if (
          this.state.phase === 'showing' &&
          this.state.activeMedia !== 'end' &&
          isVotableSlide(this.getCurrentSlide())
        ) {
          // פתיחה מפורשת — מדלגת גם על מדיית הפתיחה אם היא עדיין מוצגת
          this.setState({ activeMedia: null, openMediaPlayed: true });
          this.openVoting(event.at);
        }
        break;
    }
  }

  // -------------------------------------------------------------------------
  // גיבוי ושחזור (SPEC 7.1)
  // -------------------------------------------------------------------------

  /** `savedAt` מוזרק מבחוץ לצורך דטרמיניזם; ברירת מחדל — השעון של סביבת הריצה. */
  serialize(savedAt: string = new Date().toISOString()): GameSnapshot {
    this.saveSeq += 1;
    return {
      version: 1,
      gameId: this.game.id,
      roomId: this.roomId,
      seq: this.saveSeq,
      savedAt,
      currentSlideId: this.state.currentSlideId,
      phase: this.state.phase,
      scores: structuredClone(this.state.scores),
      votesBySlide: structuredClone(this.state.votesBySlide),
      slidesCompleted: [...this.state.slidesCompleted],
      firstClickWinners: structuredClone(this.state.firstClickWinners),
    };
  }

  restore(snapshot: GameSnapshot): void {
    if (snapshot.version !== 1) {
      throw new Error(`גרסת snapshot לא נתמכת: ${String(snapshot.version)}`);
    }
    if (snapshot.gameId !== this.game.id) {
      throw new Error(
        `ה-snapshot שייך למשחק אחר (${snapshot.gameId}) ואינו מתאים למשחק הנוכחי (${this.game.id})`,
      );
    }
    const index = this.slideIndexById(snapshot.currentSlideId);
    if (index === -1 && snapshot.phase !== 'ended') {
      throw new Error(`שקופית id=${snapshot.currentSlideId} מה-snapshot אינה קיימת בקובץ המשחק`);
    }

    this.roomId = snapshot.roomId;
    this.saveSeq = snapshot.seq;
    this.voting = freshBookkeeping();
    // הניקוד פר-שקופית אינו חלק מה-snapshot — אחרי שחזור, חזרה אחורה לשקופית
    // שכבר נוקדה תוסיף ניקוד חדש בלי להפחית את הישן (מגבלה מתועדת).
    this.awardedBySlide = {};
    this.timeBySlide = {};

    const slide = index !== -1 ? this.game.questions[index] : undefined;
    const showOpenMedia = snapshot.phase === 'showing' && slide?.openMedia.src !== '';
    this.setState({
      phase: snapshot.phase,
      currentSlideId: snapshot.currentSlideId,
      currentSlideIndex: index === -1 ? this.game.questions.length - 1 : index,
      // בשחזור לשלב תצוגה עם מדיית פתיחה — מציגים אותה מיד (כמו כניסה רגילה)
      activeMedia: showOpenMedia ? 'open' : null,
      openMediaPlayed: snapshot.phase !== 'showing',
      endMediaPlayed: false,
      subjectCommand: slide ? this.subjectCommandFor(slide) : null,
      liveVotes: null,
      scores: structuredClone(snapshot.scores),
      // זמני התגובה אינם חלק מה-snapshot — מתאפסים בשחזור (כמו הניקוד פר-שקופית)
      answerTimes: {},
      votesBySlide: structuredClone(snapshot.votesBySlide),
      slidesCompleted: [...snapshot.slidesCompleted],
      firstClickWinners: structuredClone(snapshot.firstClickWinners),
    });
  }

  /**
   * אתחול מחדש למצב ההתחלה — שקופית ראשונה, בלי ניקוד/הצבעות/זמנים. משמש
   * ל"התחלת המשחק מחדש" מתוך מסך ההגדרות באמצע משחק.
   */
  reset(): void {
    this.awardedBySlide = {};
    this.timeBySlide = {};
    this.setState(
      this.enterSlideState(0, {
        scores: {},
        answerTimes: {},
        votesBySlide: {},
        slidesCompleted: [],
        firstClickWinners: {},
      }),
    );
  }

  /**
   * איפוס ניקוד כל המשתתפים (שקופית function · score · reset_all) — מאפס את
   * הניקוד ואת זמני התגובה בלבד; המיקום, ההצבעות והשקופיות שהושלמו נשמרים.
   */
  resetScores(): void {
    this.awardedBySlide = {};
    this.timeBySlide = {};
    this.setState({ scores: {}, answerTimes: {} });
  }

  /**
   * הסרת משתתפים מהמשחק (שקופית function · players) — מוחקים את הניקוד,
   * הזמנים וההצבעות שלהם, כך שלא יופיעו יותר בדירוג. סינון הצבעות עתידיות
   * שלהם באחריות ה-host (רשימת המוסרים). מחזיר כמה הוסרו בפועל.
   */
  removeVoters(ids: readonly string[]): number {
    const remove = new Set(ids);
    if (remove.size === 0) return 0;
    const scores = { ...this.state.scores };
    const answerTimes = { ...this.state.answerTimes };
    for (const id of remove) {
      delete scores[id];
      delete answerTimes[id];
    }
    const votesBySlide: GameState['votesBySlide'] = {};
    for (const [slideId, votes] of Object.entries(this.state.votesBySlide)) {
      const next: Record<string, number> = {};
      for (const [voterId, answerId] of Object.entries(votes)) {
        if (!remove.has(voterId)) next[voterId] = answerId;
      }
      votesBySlide[Number(slideId)] = next;
    }
    for (const bySlide of Object.values(this.awardedBySlide)) for (const id of remove) delete bySlide[id];
    for (const bySlide of Object.values(this.timeBySlide)) for (const id of remove) delete bySlide[id];
    this.setState({ scores, answerTimes, votesBySlide });
    return remove.size;
  }

  // -------------------------------------------------------------------------
  // רענון תוכן "חם" (push של רענון למשחק אונליין)
  // -------------------------------------------------------------------------

  /**
   * החלפת תוכן המשחק תוך כדי ריצה, בלי לאבד את מהלך המשחק — מיועד ל"פוש
   * רענון": העורך עדכן את קובץ ה-JSON (תיקון טקסט, תמונה, תשובה, הוספת/מחיקת
   * שקופית) ורוצים שהשינוי ישתקף במשחק הפעיל מיד, אך *רק* כשנשלח אות רענון,
   * לא בסקרים אוטומטיים.
   *
   * נשמר: הניקוד המצטבר (`scores`), ההצבעות הסופיות של שקופיות שנסגרו
   * (`votesBySlide`), זוכי firstClicker, רשימת השקופיות שהושלמו, וכן המיקום
   * הנוכחי — לפי **id** השקופית ולא לפי אינדקס, כך שהוספה/הסרה של שקופיות
   * קודמות אינה מזיזה את המיקום. אם השקופית הנוכחית נעלמה מהקובץ המעודכן,
   * נכנסים מחדש לשקופית הקרובה ביותר שנותרה.
   *
   * מגבלה: אם השקופית הנוכחית עצמה שונתה בזמן הצבעה פעילה, ה-phase נשמר אך
   * מוני ההצבעה החיים עשויים להתייחס ל-answerId שכבר לא קיים — הרענון נועד
   * להישלח בין שקופיות ולא באמצע חלון הצבעה.
   */
  updateGame(newGame: GameFile): void {
    if (newGame.questions.length === 0) {
      throw new Error('קובץ המשחק המעודכן חייב לכלול לפחות שקופית אחת');
    }
    this.game = newGame;

    if (this.state.phase === 'ended') {
      // המשחק הסתיים — הזוכים מחושבים מ-scores; רק מיישרים את המיקום לסוף
      const lastIndex = newGame.questions.length - 1;
      this.setState({
        currentSlideIndex: lastIndex,
        currentSlideId: newGame.questions[lastIndex]!.id,
      });
      return;
    }

    const index = this.slideIndexById(this.state.currentSlideId);
    if (index === -1) {
      // השקופית הנוכחית נמחקה מהקובץ החדש — כניסה מחדש לקרובה ביותר, נקי
      const fallbackIndex = Math.min(
        this.state.currentSlideIndex,
        newGame.questions.length - 1,
      );
      this.voting = freshBookkeeping();
      this.setState(this.enterSlideState(fallbackIndex, {}));
      return;
    }

    // השקופית הנוכחית עדיין קיימת — שומרים מיקום/phase, מרעננים תוכן נגזר
    const slide = newGame.questions[index]!;
    const activeMedia =
      this.state.activeMedia === 'open' && slide.openMedia.src !== ''
        ? 'open'
        : this.state.activeMedia === 'end' && slide.endMedia.src !== ''
          ? 'end'
          : null;
    this.setState({
      currentSlideIndex: index,
      subjectCommand: this.subjectCommandFor(slide),
      activeMedia,
    });
  }

  // -------------------------------------------------------------------------
  // טיפול באירועים
  // -------------------------------------------------------------------------

  private handleAdvance(at?: number): void {
    const { phase, activeMedia } = this.state;
    if (phase === 'ended') return;

    // מדיה חוסמת מתנגנת — ADVANCE מדלג עליה בלבד
    if (activeMedia !== null) {
      this.handleMediaEnded(at);
      return;
    }

    const slide = this.getCurrentSlide();

    if (phase === 'showing') {
      // מדיית הפתיחה כבר הוצגה בכניסה; ADVANCE כאן פותח הצבעה / מתקדם
      if (isVotableSlide(slide)) {
        this.openVoting(at);
      } else {
        this.advanceToNextSlide(at);
      }
      return;
    }

    if (phase === 'voting') {
      this.closeVoting();
      return;
    }

    // results: שלב מדיית הסיום — מוצג רק בלחיצה מפורשת
    if (slide.endMedia.src !== '' && !this.state.endMediaPlayed) {
      this.setState({ activeMedia: 'end' });
      return;
    }
    this.advanceToNextSlide(at);
  }

  private handleBack(at?: number): void {
    if (this.state.phase === 'ended') {
      // חזרה מסוף המשחק — כניסה מחדש לשקופית האחרונה
      this.reenterSlide(this.state.currentSlideIndex, at);
      return;
    }
    // בשקופית הראשונה אין "קודמת" — BACK מריץ אותה מחדש
    const targetIndex = Math.max(0, this.state.currentSlideIndex - 1);
    this.reenterSlide(targetIndex, at);
  }

  private handleGoto(slideId: number, at?: number): void {
    const index = this.slideIndexById(slideId);
    if (index === -1) return; // id לא קיים — מתעלמים
    this.reenterSlide(index, at);
  }

  private handleVoteSnapshot(snapshot: VoteSnapshot, at?: number): void {
    if (this.state.phase !== 'voting') return;
    if (snapshot.slideId !== this.state.currentSlideId) return;
    if (snapshot.seq <= this.voting.lastSeq) return; // ישן/כפול
    this.voting.lastSeq = snapshot.seq;

    if (snapshot.voters) {
      this.voting.latestVoters = { ...snapshot.voters };
      for (const [voterId, answerId] of Object.entries(snapshot.voters)) {
        if (!(voterId in this.voting.firstSeenAt) && at !== undefined) {
          this.voting.firstSeenAt[voterId] = at;
        }
        if (!(voterId in this.voting.lockedVotes)) {
          this.voting.lockedVotes[voterId] = answerId;
        }
      }
    }
    if (snapshot.firstVoter !== undefined) {
      this.voting.latestFirstVoter = snapshot.firstVoter;
    }

    // כש-allowChangeVote כבוי, ההצבעה שתנוקד היא הראשונה (הנעולה) — לכן גם
    // המונים החיים מוצגים לפי ההצבעות הנעולות, כדי שהמסך לא יראה שינויי הצבעה
    // שלא ייספרו. עם allowChangeVote (או בלי voters) — המונים מה-snapshot כרגיל.
    const locked =
      !this.allowChangeVoteFor(this.getCurrentSlide()) && snapshot.voters !== undefined;
    this.setState({
      liveVotes: locked
        ? {
            counts: countsOfVotes(this.voting.lockedVotes),
            total: Object.keys(this.voting.lockedVotes).length,
          }
        : { counts: { ...snapshot.counts }, total: snapshot.total },
    });
  }

  private handleMediaEnded(_at?: number): void {
    const { activeMedia } = this.state;
    if (activeMedia === 'open') {
      // המדיה הסתיימה/דולגה — חוזרים לשלב התצוגה; ההמשך בלחיצה הבאה
      this.setState({ activeMedia: null, openMediaPlayed: true });
      return;
    }
    if (activeMedia === 'end') {
      this.setState({ activeMedia: null, endMediaPlayed: true });
    }
  }

  // -------------------------------------------------------------------------
  // מעברי מצב
  // -------------------------------------------------------------------------

  private openVoting(at?: number): void {
    this.voting = freshBookkeeping();
    this.voting.openedAt = at ?? null;
    this.setState({ phase: 'voting', liveVotes: null });
  }

  /** סגירת חלון ההצבעה: קיבוע הצבעות, ניקוד, ומעבר לתוצאות (SPEC 5.2). */
  private closeVoting(): void {
    const slide = this.getCurrentSlide();
    const slideId = slide.id;

    const finalVotes = this.allowChangeVoteFor(slide)
      ? { ...(this.voting.latestVoters ?? {}) }
      : { ...this.voting.lockedVotes };

    const firstClickWinners = { ...this.state.firstClickWinners };
    if (slide.setting.firstClicker && this.voting.latestFirstVoter !== null) {
      firstClickWinners[slideId] = this.voting.latestFirstVoter;
    } else {
      delete firstClickWinners[slideId];
    }

    const awards = this.computeAwards(slide, finalVotes, firstClickWinners[slideId]);

    // חזרה על שקופית: מפחיתים את הניקוד הקודם שלה לפני הוספת החדש
    const scores = { ...this.state.scores };
    const previousAwards = this.awardedBySlide[slideId];
    if (previousAwards) {
      for (const [voterId, points] of Object.entries(previousAwards)) {
        const next = (scores[voterId] ?? 0) - points;
        if (next === 0) delete scores[voterId];
        else scores[voterId] = next;
      }
    }
    for (const [voterId, points] of Object.entries(awards)) {
      scores[voterId] = (scores[voterId] ?? 0) + points;
    }
    this.awardedBySlide[slideId] = awards;

    // זמני תגובה (ms) של מי שהצביע בשקופית זו — לשובר-שוויון לפי מהירות.
    // latency = מתי נראתה הצבעתו לראשונה פחות זמן פתיחת ההצבעה (≥0).
    const latencies: Record<string, number> = {};
    const openedAt = this.voting.openedAt;
    if (openedAt !== null) {
      for (const voterId of Object.keys(finalVotes)) {
        const seen = this.voting.firstSeenAt[voterId];
        if (seen !== undefined) latencies[voterId] = Math.max(0, seen - openedAt);
      }
    }
    const answerTimes = structuredClone(this.state.answerTimes);
    const previousTimes = this.timeBySlide[slideId];
    if (previousTimes) {
      for (const [voterId, ms] of Object.entries(previousTimes)) {
        const cur = answerTimes[voterId];
        if (!cur) continue;
        const count = cur.count - 1;
        if (count <= 0) delete answerTimes[voterId];
        else answerTimes[voterId] = { totalMs: cur.totalMs - ms, count };
      }
    }
    for (const [voterId, ms] of Object.entries(latencies)) {
      const cur = answerTimes[voterId] ?? { totalMs: 0, count: 0 };
      answerTimes[voterId] = { totalMs: cur.totalMs + ms, count: cur.count + 1 };
    }
    this.timeBySlide[slideId] = latencies;

    this.setState({
      phase: 'results',
      scores,
      answerTimes,
      votesBySlide: { ...this.state.votesBySlide, [slideId]: finalVotes },
      firstClickWinners,
      // הפילוח שמוצג בחשיפה (עוגת סקר / אחוזי תשובות) נגזר מ-liveVotes — מיישרים
      // אותו להצבעות הסופיות שנשמרו ונוקדו, כך שהמסך, הדוח וה-API תמיד זהים.
      liveVotes: {
        counts: countsOfVotes(finalVotes),
        total: Object.keys(finalVotes).length,
      },
      // endMedia אינו מתנגן אוטומטית — הוא שלב נפרד שמופעל ב-ADVANCE
      activeMedia: null,
    });
  }

  /** חישוב הניקוד לשקופית שנסגרה: voterId → נקודות (רק ערכים חיוביים). */
  private computeAwards(
    slide: Slide,
    finalVotes: Record<string, number>,
    firstClickWinner: string | undefined,
  ): Record<string, number> {
    const awards: Record<string, number> = {};
    const baseScore = slide.question.scoreForQue;

    const isTrivia = slide.type === 'trivia';
    const participationScoring =
      !isTrivia && this.surveyParticipationScoring && baseScore > 0;
    if (!isTrivia && !participationScoring) return awards;

    const correctIds = new Set(
      slide.question.answers.filter((a) => a.correct).map((a) => a.id),
    );

    for (const [voterId, answerId] of Object.entries(finalVotes)) {
      // trivia: רק תשובה נכונה מזכה; survey/ans_images: ניקוד השתתפות
      if (isTrivia && !correctIds.has(answerId)) continue;
      // firstClicker: רק המצביע הראשון מקבל ניקוד
      if (slide.setting.firstClicker && voterId !== firstClickWinner) continue;
      // correctlyAnsweredBefore: רק מי שצדק בכל שאלות ה-trivia הקודמות
      if (slide.setting.correctlyAnsweredBefore && !this.answeredAllPreviousTriviaCorrectly(voterId, slide)) {
        continue;
      }
      const points = this.effectiveScore(slide, voterId, baseScore);
      if (points > 0) awards[voterId] = points;
    }
    return awards;
  }

  /** scoringReduction: אחרי `seconds` שניות מפתיחת ההצבעה הניקוד יורד ל-`score`. */
  private effectiveScore(slide: Slide, voterId: string, baseScore: number): number {
    const reduction = slide.setting.scoringReduction;
    if (!reduction.active) return baseScore;
    const openedAt = this.voting.openedAt;
    const firstSeenAt = this.voting.firstSeenAt[voterId];
    // בלי מידע זמן (לא הוזרק `at`) — אין הפחתה, ניתן ניקוד מלא
    if (openedAt === null || firstSeenAt === undefined) return baseScore;
    return firstSeenAt - openedAt >= reduction.seconds * 1000 ? reduction.score : baseScore;
  }

  /** בדיקת סינון correctlyAnsweredBefore מול כל שקופיות ה-trivia שקדמו לשקופית הנתונה. */
  private answeredAllPreviousTriviaCorrectly(voterId: string, currentSlide: Slide): boolean {
    for (const slide of this.game.questions) {
      if (slide.id === currentSlide.id) break;
      if (slide.type !== 'trivia') continue;
      const votes = this.state.votesBySlide[slide.id];
      const answerId = votes?.[voterId];
      if (answerId === undefined) return false;
      const answer = slide.question.answers.find((a) => a.id === answerId);
      if (!answer?.correct) return false;
    }
    return true;
  }

  private advanceToNextSlide(at?: number): void {
    const currentId = this.state.currentSlideId;
    const slidesCompleted = this.state.slidesCompleted.includes(currentId)
      ? this.state.slidesCompleted
      : [...this.state.slidesCompleted, currentId];

    const nextIndex = this.state.currentSlideIndex + 1;
    if (nextIndex >= this.game.questions.length) {
      this.setState({
        phase: 'ended',
        slidesCompleted,
        activeMedia: null,
        subjectCommand: null,
        liveVotes: null,
      });
      return;
    }
    this.setState(this.enterSlideState(nextIndex, { slidesCompleted }, at));
  }

  /** כניסה חוזרת לשקופית (BACK/GOTO) — היא יוצאת מרשימת המושלמות ומתחילה מחדש. */
  private reenterSlide(index: number, at?: number): void {
    const slide = this.game.questions[index];
    if (!slide) return;
    const slidesCompleted = this.state.slidesCompleted.filter((id) => id !== slide.id);
    this.setState(this.enterSlideState(index, { slidesCompleted }, at));
  }

  /**
   * בניית מצב הכניסה לשקופית: phase 'showing', ומדיית פתיחה (אם קיימת)
   * מוצגת מיד — בלי מסך ביניים ריק. שאר השלבים (הצגת שאלה, פתיחת הצבעה)
   * מופעלים ב-ADVANCE מפורש של המפעיל/המנחה.
   */
  private enterSlideState(
    index: number,
    carried: Partial<
      Pick<GameState, 'scores' | 'answerTimes' | 'votesBySlide' | 'slidesCompleted' | 'firstClickWinners'>
    >,
    _at?: number,
  ): GameState {
    const slide = this.game.questions[index];
    if (!slide) {
      throw new Error(`שקופית באינדקס ${index} אינה קיימת`);
    }

    this.voting = freshBookkeeping();

    const hasOpenMedia = slide.openMedia.src !== '';
    const next: GameState = {
      phase: 'showing',
      currentSlideId: slide.id,
      currentSlideIndex: index,
      // מדיית הפתיחה מוצגת מיד עם הכניסה — אין מסך צבע ריק לפניה
      activeMedia: hasOpenMedia ? 'open' : null,
      openMediaPlayed: false,
      endMediaPlayed: false,
      subjectCommand: this.subjectCommandFor(slide),
      liveVotes: null,
      scores: carried.scores ?? this.state.scores,
      answerTimes: carried.answerTimes ?? this.state.answerTimes,
      votesBySlide: carried.votesBySlide ?? this.state.votesBySlide,
      slidesCompleted: carried.slidesCompleted ?? this.state.slidesCompleted,
      firstClickWinners: carried.firstClickWinners ?? this.state.firstClickWinners,
    };
    return next;
  }

  private slideIndexById(slideId: number): number {
    return this.game.questions.findIndex((slide) => slide.id === slideId);
  }

  /** זיהוי שקופיות פקודה (SPEC סעיף 4) — ה-side effect עצמו באחריות ה-host. */
  private subjectCommandFor(slide: Slide): SubjectCommand {
    if (slide.type !== 'subject') return null;
    const kind = classifySubjectSlide(slide.question.que);
    if (kind === 'dynamic-image') {
      const url = extractDynamicImageUrl(slide.question.que, this.game.id);
      return url === null ? null : { kind: 'dynamic-image', url };
    }
    if (kind === 'send-data') return { kind: 'send-data' };
    return null;
  }

  // -------------------------------------------------------------------------
  // ניהול state + מנויים
  // -------------------------------------------------------------------------

  private setState(update: Partial<GameState> | GameState): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
}

export type { GamePhase, GameSnapshot, GameState };
