/**
 * מסכי המסגרת (SPEC סעיף 9): פתיחה/התחברות, זוכים, רשימת זוכים.
 */

import { useEffect, useRef, useState } from 'react';
import type { GameEngine } from '../engine/index.ts';
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
 * מיקומי הפודיום במסך המנצחים — אחוזים ביחס לבמה, מכוונים לרקע הפודיום הסטנדרטי
 * (winnersMedia). הסדר משמאל לימין הוא 4·2·1·3·5: מקום 1 במרכז (הגבוה), 2/3
 * לצדדים, 4/5 בקצוות. מציגים רק שם + ניקוד — הפודיום עצמו מגיע מהרקע.
 */
const PODIUM_POS: Record<number, { x: number; y: number }> = {
  1: { x: 50, y: 74 }, // מרכז
  2: { x: 36, y: 74 }, // שמאל-מרכז
  3: { x: 64, y: 74 }, // ימין-מרכז
  4: { x: 21, y: 74 }, // קצה שמאל
  5: { x: 79, y: 74 }, // קצה ימין
};
/** מספר מקומות הפודיום המרביים (לפי הרקע הסטנדרטי). */
const MAX_PODIUM = 5;

/**
 * צפיפות טבלת המובילים לפי כמות המובילים — מעט מובילים = כרטיסים גדולים עם
 * נוכחות; רבים = קומפקטי (ובעמודה צרה כשמוצג לצד דירוג קבוצתי).
 */
function leadersDensity(count: number): 'xl' | 'lg' | 'md' | 'sm' {
  if (count <= 3) return 'xl';
  if (count <= 6) return 'lg';
  if (count <= 10) return 'md';
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
  engine: GameEngine;
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
        <h1 className="opening-title lobby-title">
          {setting.titleThroughoutGame || engine.getGame().name}
        </h1>
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
          {players.length === 0 && (
            <div className="lobby-empty">ממתינים לשחקנים… לחצו מקש כלשהו במכשיר כדי להתחבר</div>
          )}
        </div>
        <p className="opening-hint">לחצו רווח כדי להתחיל</p>
      </div>
    </div>
  );
}

/**
 * מסך המנצחים הסופי — פודיום. הרקע (winnersMedia) הוא תמונת הפודיום; אנחנו
 * מניחים מעליו רק את השם והניקוד של כל מנצח, במיקום הקבוע של מקומו (PODIUM_POS).
 * `revealed` קובע כמה מקומות כבר נחשפו — נחשפים אחד-אחד מהמקום האחרון לראשון
 * (המנחה חושף עוד אחד בכל רווח). כשלא מסופק (למשל בשקופית פונקציה) — הכל גלוי.
 */
export function WinnersScreen({
  engine,
  nameOf = identityName,
  revealed,
}: {
  engine: GameEngine;
  nameOf?: NameResolver;
  revealed?: number;
}) {
  const setting = engine.getGame().setting;
  const winners = engine.getWinners(setting.multiWinners).slice(0, MAX_PODIUM);
  const total = winners.length;
  const shown = revealed ?? total; // ללא בקרת חשיפה — מציגים את כולם
  return (
    <div className="screen winners-screen winners-podium-screen">
      {setting.winnersMedia.src !== '' && (
        <div className="screen-background">
          <MediaPlayer src={setting.winnersMedia.src} asBackground />
        </div>
      )}
      {total === 0 && (
        <div className="screen-content">
          <p className="winners-empty">אין משתתפים עם ניקוד</p>
        </div>
      )}
      {winners.map((winner, index) => {
        const rank = index + 1;
        const pos = PODIUM_POS[rank] ?? PODIUM_POS[MAX_PODIUM]!;
        // חשיפה מהאחרון לראשון: מקום r מופיע כשנחשפו לפחות (total − r + 1) מקומות.
        const isShown = shown >= total - rank + 1;
        return (
          <div
            key={winner.voterId}
            className={`podium-slot${isShown ? ' is-shown' : ''}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            <FitText className="podium-name">{nameOf(winner.voterId)}</FitText>
            <span className="podium-score">{winner.score} נק׳</span>
          </div>
        );
      })}
    </div>
  );
}

export function WinnersListScreen({
  engine,
  nameOf = identityName,
  roster,
}: {
  engine: GameEngine;
  nameOf?: NameResolver;
  /** מרשם הקבוצות — כשמסופק ויש שיוכים, מוצג גם דירוג קבוצתי לצד הדירוג האישי. */
  roster?: RosterData;
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
                const standings = groupStandings(roster, cat.id, state.scores, state.answerTimes);
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
}: {
  engine: GameEngine;
  nameOf?: NameResolver;
  /** מונה חיצוני: כל עלייה שלו מדפדפת עמוד מיד (רווח/0 של המנחה). */
  pageBump?: number;
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
  const [page, setPage] = useState(0);
  // לולאה אוטומטית בין העמודים (רק כשיש יותר מעמוד אחד)
  useEffect(() => {
    setPage(0);
    if (pages <= 1) return undefined;
    const timer = window.setInterval(() => setPage((p) => (p + 1) % pages), SCORES_PAGE_MS);
    return () => window.clearInterval(timer);
  }, [pages]);
  // דפדוף ידני של המנחה (רווח/0) — עמוד הבא מיד, בלי להמתין ללולאה.
  // מגיבים רק לעלייה שקרתה אחרי ה-mount (לא לערך שהצטבר בכניסה קודמת למסך).
  const lastBumpRef = useRef(pageBump);
  useEffect(() => {
    if (pageBump === lastBumpRef.current) return;
    lastBumpRef.current = pageBump;
    setPage((p) => (p + 1) % pages);
  }, [pageBump, pages]);
  const safePage = page % pages;
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
