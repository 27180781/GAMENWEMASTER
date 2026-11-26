/**
 * מסכי המסגרת (SPEC סעיף 9): פתיחה/התחברות, זוכים, רשימת זוכים.
 */

import { useEffect, useRef, useState } from 'react';
import type { EngineView } from './engineView.ts';
import { avatarColor, railInitial } from './avatar.ts';
import { FitText } from './FitText.tsx';
import { MediaPlayer } from './MediaPlayer.tsx';
import { QrCode } from './QrCode.tsx';
import type { RailPlayer } from './QuestionSlide.tsx';
import { groupStandings, hasGroupData } from '../app/groupScore.ts';
import type { RosterData } from '../app/roster.ts';

/** מדליה ל-3 המקומות הראשונים; שאר המקומות מציגים את המספר בתג. */
const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/**
 * צפיפות טבלת המובילים לפי כמות המובילים — מעט מובילים = כרטיסים גדולים עם
 * נוכחות; רבים = קומפקטי (ובעמודה צרה כשמוצג לצד דירוג קבוצתי).
 */
function leadersDensity(count: number): 'xl' | 'lg' | 'md' | 'sm' {
  if (count <= 3) return 'xl';
  if (count <= 6) return 'lg';
  // עמודה אחת ב-md: 8 שורות נגמרות כ-120 פיקסלים מעל תחתית המסך, 9 כבר צמודות אליה
  // (כ-30 פיקסלים) ו-10 נחתכות. עד 2026-11 גם 9–10 קיבלו md, והשורה העשירית נחתכה
  // בכל הערכות, גם בעמודה האישית שליד הדירוג הקבוצתי. מ-9 שורות: שתי עמודות.
  if (count <= 8) return 'md';
  return 'sm';
}

/** ברירת מחדל: אם לא סופק מרשם שמות — מציגים את המספר עצמו. */
type NameResolver = (voterId: string) => string;
const identityName: NameResolver = (voterId) => voterId;

/**
 * רמת צפיפות מסך הלובי לפי מספר המחוברים — הצ׳יפים מתכווצים ככל שמתחברים יותר,
 * כדי להציג את כולם בלי גלילה (בכמויות גדולות מציגים אווטרים בלבד).
 */
function lobbyDensity(count: number): 'lg' | 'md' | 'sm' | 'xs' {
  if (count <= 60) return 'lg';
  if (count <= 150) return 'md';
  if (count <= 400) return 'sm';
  return 'xs';
}

/**
 * מסך התחברות שחקנים (לובי) — המסך הראשון אחרי ההגדרות. מציג בזמן אמת את כל
 * מי שהתחבר למשחק (לחץ מקש כלשהו) — באונליין (סוקט) ובדמו. רווח מתחיל.
 * מציג את כולם בלי הגבלה; הכרטיסים מתכווצים לפי כמות המחוברים.
 */
export function LobbyScreen({
  engine,
  players,
  qrUrl,
  joinInfo,
}: {
  engine: EngineView;
  players: RailPlayer[];
  /** כשמוגדר — מציג קוד QR גדול בצד הלובי להתחברות מהטלפון. */
  qrUrl?: string;
  /** מספר החיוג וקוד המשחק — מוצגים בגדול בשליש העליון של הלובי. */
  joinInfo?: { dial: string; code: string };
}) {
  const setting = engine.getGame().setting;
  const density = lobbyDensity(players.length);
  return (
    <div className="screen lobby-screen">
      {setting.gameMedia.src !== '' && (
        <div className="screen-background">
          <MediaPlayer src={setting.gameMedia.src} asBackground />
        </div>
      )}
      {qrUrl !== undefined && qrUrl !== '' && (
        <aside className="lobby-qr">
          <QrCode value={qrUrl} size={300} />
          <div className="lobby-qr-caption">סרקו להצטרפות מהטלפון 📱</div>
        </aside>
      )}
      <div className={`screen-content lobby-content${joinInfo !== undefined ? ' lobby-content--join' : ''}`}>
        {setting.logo.src !== '' && <img className="opening-logo lobby-logo" src={setting.logo.src} alt="" />}
        {/* בלובי האונליין (עם מספר החיוג הגדול) מסתירים את שם המשחק — המספר והקוד
            הם ה"גיבור" בראש המסך. בלובי הדמו שם המשחק עדיין מוצג. */}
        {joinInfo === undefined && (
          <h1 className="opening-title lobby-title">
            {setting.titleThroughoutGame || engine.getGame().name}
          </h1>
        )}
        {joinInfo !== undefined && (
          <div className="lobby-join">
            <span className="lobby-join-label">חייגו למספר</span>
            <span className="lobby-join-dial" dir="ltr">{joinInfo.dial}</span>
            <span className="lobby-join-label">והקישו את הקוד</span>
            <span className="lobby-join-code" dir="ltr">{joinInfo.code}</span>
          </div>
        )}
        <div className="lobby-count">
          <span className="lobby-count-dot" />
          <span className="lobby-count-num">{players.length}</span> מחוברים
        </div>
        <div className={`lobby-grid lobby-grid--${density}`}>
          {players.map((player) => (
            <div key={player.id} className="lobby-chip" title={player.name}>
              <span className="lobby-avatar" style={{ background: player.color }}>
                {player.initial}
              </span>
              <FitText className="lobby-name">{player.name}</FitText>
            </div>
          ))}
          {players.length === 0 && <div className="lobby-empty">ממתינים לשחקנים…</div>}
        </div>
      </div>
    </div>
  );
}

/** מסך המנצחים הסופי — בקוד, שלושה סגנונות (src/render/winners/). */
export { WinnersScreen } from './winners/WinnersScreen.tsx';

export function WinnersListScreen({
  engine,
  nameOf = identityName,
  roster,
  groupBonus,
}: {
  engine: EngineView;
  nameOf?: NameResolver;
  /** מרשם הקבוצות — כשמסופק ויש שיוכים, מוצג גם דירוג קבוצתי לצד הדירוג האישי. */
  roster?: RosterData;
  /**
   * בונוס ידני לקבוצות (groupId → נקודות), כמו במסך דירוג הקבוצות (מקש 4) ובפס
   * הקבוצות. עד 2026-10 הדירוג כאן חושב בלעדיו, ולכן קבוצה שקיבלה בונוס הופיעה
   * כאן במקום אחר ובניקוד אחר.
   */
  groupBonus?: Readonly<Record<string, number>>;
}) {
  const setting = engine.getGame().setting;
  // מספר המובילים כפי שהוגדר בקובץ המשחק (winnersListCount; ברירת מחדל 5).
  const winners = engine.getWinners(setting.winnersListCount);
  const state = engine.getState();
  const showGroups = roster !== undefined && hasGroupData(roster);
  const categories = showGroups ? roster.categories.filter((c) => c.groups.length > 0) : [];
  return (
    <div className="screen winners-screen">
      {setting.winnersListMedia.src !== '' && (
        <div className="screen-background">
          <MediaPlayer src={setting.winnersListMedia.src} asBackground />
        </div>
      )}
      <div className="screen-content">
        <h1 className="winners-title">המובילים</h1>
        <div className={`winners-layout${showGroups ? ' winners-layout--with-groups' : ''}`}>
          <div className="winners-col">
            <h2 className="winners-col-title">דירוג אישי</h2>
            <ol className={`leaders-board leaders-board--${leadersDensity(winners.length)}`}>
              {winners.map((winner, index) => {
                const rank = index + 1;
                const name = nameOf(winner.voterId);
                return (
                  <li
                    key={winner.voterId}
                    className={`leader-card${rank <= 3 ? ` leader-card--top leader-card--r${rank}` : ''}`}
                  >
                    <span className="leader-rank">{MEDALS[rank] ?? rank}</span>
                    <span className="leader-avatar" style={{ background: avatarColor(winner.voterId) }}>
                      {railInitial(name)}
                    </span>
                    <FitText className="leader-name">{name}</FitText>
                    <span className="leader-score">
                      {winner.score}
                      <small> נק׳</small>
                    </span>
                  </li>
                );
              })}
              {winners.length === 0 && <li className="leaders-empty">אין משתתפים עם ניקוד</li>}
            </ol>
          </div>
          {showGroups && (
            <div className="winners-col group-standings">
              <h2 className="winners-col-title">דירוג קבוצתי (ממוצע)</h2>
              {categories.map((cat) => {
                const standings = groupStandings(roster, cat.id, state.scores, state.answerTimes, groupBonus);
                return (
                  <div key={cat.id} className="group-cat">
                    <h3 className="group-cat-name">{cat.name || 'קבוצות'}</h3>
                    <ol className="group-list">
                      {standings.map((s, index) => (
                        <li key={s.groupId}>
                          <span className="winner-rank">{index + 1}.</span>
                          <span className="group-num">{s.number}</span>
                          <FitText className="winner-name">{s.name || 'קבוצה'}</FitText>
                          <span className="group-members">{s.memberCount}👤</span>
                          <span className="winner-score">{Math.round(s.avgScore)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** כמה משתתפים בכל עמוד של מסך הניקוד, וכמה זמן (ms) כל עמוד מוצג לפני המעבר. */
const SCORES_PER_PAGE = 18;
const SCORES_PAGE_MS = 6500;

/**
 * מסך "הניקוד של כל המשתתפים" — מוצג אחרי מסך המנצחים. מציג את כל מי שצבר
 * ניקוד, ממוין מהגבוה לנמוך. אם כולם לא נכנסים בעמוד אחד — מתחלק לעמודים
 * (עד SCORES_PER_PAGE בכל עמוד) ועובר ביניהם בלולאה אוטומטית, כדי שיהיה זמן
 * לקרוא וכל אחד יראה כמה צבר. עמוד יחיד = מוצג קבוע (בלי לולאה).
 */
export function AllScoresScreen({
  engine,
  nameOf = identityName,
  pageBump = 0,
  page: controlledPage,
  onPageChange,
}: {
  engine: EngineView;
  nameOf?: NameResolver;
  /** מונה חיצוני: כל עלייה שלו מדפדפת עמוד מיד (רווח/0 של המנחה). */
  pageBump?: number;
  /**
   * עמוד קבוע מבחוץ — מסך הצפייה מציג את העמוד שהמסך הראשי מציג, בלי לולאה
   * משלו (שהייתה מתחילה בזמן אחר ומדפדפת לא בסנכרון).
   */
  page?: number;
  /** מדווח על העמוד המוצג — כדי שמסך הצפייה יוכל לעקוב. */
  onPageChange?: (page: number) => void;
}) {
  const setting = engine.getGame().setting;
  // כל המשתתפים — כולל מי שהצביע אך לא צבר נקודות (מוצג עם 0), כדי שבאמת
  // "כל אחד יראה כמה צבר". המנוקדים לפי דירוג המנוע; חסרי-הניקוד אחריהם.
  const scored = engine.getWinners(Number.MAX_SAFE_INTEGER);
  const seen = new Set(scored.map((w) => w.voterId));
  const state = engine.getState();
  const zeroIds = new Set<string>();
  for (const votes of Object.values(state.votesBySlide)) {
    for (const id of Object.keys(votes)) if (!seen.has(id)) zeroIds.add(id);
  }
  const all = [
    ...scored,
    ...[...zeroIds].sort((a, b) => a.localeCompare(b)).map((voterId) => ({ voterId, score: 0 })),
  ];
  const pages = Math.max(1, Math.ceil(all.length / SCORES_PER_PAGE));
  const [ownPage, setPage] = useState(0);
  const controlled = controlledPage !== undefined;
  // לולאה אוטומטית בין העמודים (רק כשיש יותר מעמוד אחד)
  useEffect(() => {
    setPage(0);
    if (pages <= 1 || controlled) return undefined;
    const timer = window.setInterval(() => setPage((p) => (p + 1) % pages), SCORES_PAGE_MS);
    return () => window.clearInterval(timer);
  }, [pages, controlled]);
  // דפדוף ידני של המנחה (רווח/0) — עמוד הבא מיד, בלי להמתין ללולאה.
  // מגיבים רק לעלייה שקרתה אחרי ה-mount (לא לערך שהצטבר בכניסה קודמת למסך).
  const lastBumpRef = useRef(pageBump);
  useEffect(() => {
    if (pageBump === lastBumpRef.current) return;
    lastBumpRef.current = pageBump;
    setPage((p) => (p + 1) % pages);
  }, [pageBump, pages]);
  const page = controlled ? controlledPage : ownPage;
  const safePage = ((page % pages) + pages) % pages;
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  useEffect(() => {
    onPageChangeRef.current?.(safePage);
  }, [safePage]);
  const start = safePage * SCORES_PER_PAGE;
  const slice = all.slice(start, start + SCORES_PER_PAGE);
  return (
    <div className="screen winners-screen all-scores-screen">
      {setting.winnersListMedia.src !== '' && (
        <div className="screen-background">
          <MediaPlayer src={setting.winnersListMedia.src} asBackground />
        </div>
      )}
      <div className="screen-content">
        <h1 className="winners-title">הניקוד של כל המשתתפים</h1>
        {all.length === 0 ? (
          <p className="winners-empty">אין משתתפים עם ניקוד</p>
        ) : (
          // key=safePage → העמוד נטען מחדש בכל מעבר, ואיתו אנימציית הכניסה
          <ol className="scores-grid" key={safePage}>
            {slice.map((row, i) => (
              <li className="score-cell" key={row.voterId} style={{ animationDelay: `${i * 35}ms` }}>
                <span className="score-rank">{start + i + 1}</span>
                <FitText className="score-name">{nameOf(row.voterId)}</FitText>
                <span className="score-pts">{row.score}</span>
              </li>
            ))}
          </ol>
        )}
        {pages > 1 && (
          <div className="scores-pager">
            {Array.from({ length: pages }, (_, i) => (
              <span key={i} className={`scores-dot${i === safePage ? ' is-active' : ''}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
