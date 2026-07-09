/**
 * GameEngine — מכונת המצבים של המשחק (SPEC סעיפים 1, 5, 7).
 *
 * מחלקה טהורה: בלי React, בלי DOM, בלי טיימרים. זמן מוזרק מבחוץ דרך השדה
 * `at` שעל האירועים (ל-scoringReduction) ודרך VOTING_TIMEOUT (סגירת חלון
 * ההצבעה). ה-host אחראי להריץ את הטיימרים ולבצע side effects של שקופיות
 * פקודה (subjectCommand) — המנוע רק חושף אותם ב-state.
 *
 * מחזור חיים של שקופית שאלה (SPEC 5.1):
 *   ENTER → [openMedia] → SHOW_QUESTION → VOTING_OPEN (אם slideStartVoting)
 *         → VOTING_TIMEOUT/ADVANCE → תוצאות + ניקוד → [endMedia] → ADVANCE
 *
 * כלל ADVANCE: כשמדיה חוסמת מתנגנת — ADVANCE מדלג עליה בלבד; אחרת הוא מבצע
 * את הצעד הבא במחזור (פתיחת הצבעה → סגירה → שקופית הבאה).
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

export class GameEngine {
  private readonly game: GameFile;
  private readonly surveyParticipationScoring: boolean;
  private roomId: string | null;

  private state: GameState;
  private readonly listeners = new Set<() => void>();

  private voting: VotingBookkeeping = freshBookkeeping();
  /** ניקוד שהוענק פר שקופית — מאפשר חישוב מחדש כשחוזרים לשקופית. */
  private awardedBySlide: Record<number, Record<string, number>> = {};
  private saveSeq = 0;

  constructor(game: GameFile, options: EngineOptions = {}) {
    this.game = game;
    this.surveyParticipationScoring = options.surveyParticipationScoring ?? false;
    this.roomId = options.roomId ?? null;
    this.state = this.enterSlideState(0, {
      scores: {},
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

  /** מובילי טבלת הניקוד, ממוינים יורד (ברירת מחדל: לפי multiWinners). */
  getWinners(limit: number = this.game.setting.multiWinners): { voterId: string; score: number }[] {
    return Object.entries(this.state.scores)
      .map(([voterId, score]) => ({ voterId, score }))
      .sort((a, b) => b.score - a.score || a.voterId.localeCompare(b.voterId))
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

    const slide = index !== -1 ? this.game.questions[index] : undefined;
    this.setState({
      phase: snapshot.phase,
      currentSlideId: snapshot.currentSlideId,
      currentSlideIndex: index === -1 ? this.game.questions.length - 1 : index,
      // מדיה היא מצב חולף — לא משוחזרת; ה-renderer מציג את השקופית מחדש.
      activeMedia: null,
      endMediaPlayed: snapshot.phase === 'results',
      subjectCommand: slide ? this.subjectCommandFor(slide) : null,
      liveVotes: null,
      scores: structuredClone(snapshot.scores),
      votesBySlide: structuredClone(snapshot.votesBySlide),
      slidesCompleted: [...snapshot.slidesCompleted],
      firstClickWinners: structuredClone(snapshot.firstClickWinners),
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

    // results
    this.advanceToNextSlide(at);
  }

  private handleBack(at?: number): void {
    if (this.state.phase === 'ended') {
      // חזרה מסוף המשחק — כניסה מחדש לשקופית האחרונה
      this.reenterSlide(this.state.currentSlideIndex, at);
      return;
    }
    if (this.state.currentSlideIndex === 0) return;
    this.reenterSlide(this.state.currentSlideIndex - 1, at);
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

    this.setState({
      liveVotes: { counts: { ...snapshot.counts }, total: snapshot.total },
    });
  }

  private handleMediaEnded(at?: number): void {
    const { activeMedia } = this.state;
    if (activeMedia === 'open') {
      const slide = this.getCurrentSlide();
      if (isVotableSlide(slide) && slide.setting.slideStartVoting) {
        this.setState({ activeMedia: null });
        this.openVoting(at);
      } else {
        this.setState({ activeMedia: null });
      }
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

    const finalVotes = slide.setting.allowChangeVote
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

    this.setState({
      phase: 'results',
      scores,
      votesBySlide: { ...this.state.votesBySlide, [slideId]: finalVotes },
      firstClickWinners,
      // endMedia מתנגן אוטומטית עם הצגת התוצאות (SPEC 5.1)
      activeMedia: slide.endMedia.src !== '' && !this.state.endMediaPlayed ? 'end' : null,
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
   * בניית מצב הכניסה לשקופית. מאחד את לוגיקת ENTER של SPEC 5.1:
   * openMedia אם קיים; אחרת אם slideStartVoting — ההצבעה נפתחת מיד.
   */
  private enterSlideState(
    index: number,
    carried: Partial<
      Pick<GameState, 'scores' | 'votesBySlide' | 'slidesCompleted' | 'firstClickWinners'>
    >,
    at?: number,
  ): GameState {
    const slide = this.game.questions[index];
    if (!slide) {
      throw new Error(`שקופית באינדקס ${index} אינה קיימת`);
    }

    this.voting = freshBookkeeping();

    const hasOpenMedia = slide.openMedia.src !== '';
    const startVotingNow = !hasOpenMedia && isVotableSlide(slide) && slide.setting.slideStartVoting;
    if (startVotingNow) this.voting.openedAt = at ?? null;

    const next: GameState = {
      phase: startVotingNow ? 'voting' : 'showing',
      currentSlideId: slide.id,
      currentSlideIndex: index,
      activeMedia: hasOpenMedia ? 'open' : null,
      endMediaPlayed: false,
      subjectCommand: this.subjectCommandFor(slide),
      liveVotes: null,
      scores: carried.scores ?? this.state.scores,
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
