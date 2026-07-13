/**
 * מסכי המסגרת (SPEC סעיף 9): פתיחה/התחברות, זוכים, רשימת זוכים.
 */

import type { GameEngine } from '../engine/index.ts';
import { FitText } from './FitText.tsx';
import { MediaPlayer } from './MediaPlayer.tsx';
import { QrCode } from './QrCode.tsx';
import type { RailPlayer } from './QuestionSlide.tsx';
import { groupStandings, hasGroupData } from '../app/groupScore.ts';
import type { RosterData } from '../app/roster.ts';

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
}: {
  engine: GameEngine;
  players: RailPlayer[];
  /** כשמוגדר — מציג קוד QR גדול בצד הלובי להתחברות מהטלפון. */
  qrUrl?: string;
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
      <div className="screen-content lobby-content">
        {setting.logo.src !== '' && <img className="opening-logo lobby-logo" src={setting.logo.src} alt="" />}
        <h1 className="opening-title lobby-title">
          {setting.titleThroughoutGame || engine.getGame().name}
        </h1>
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

export function OpeningScreen({ engine }: { engine: GameEngine }) {
  const setting = engine.getGame().setting;
  return (
    <div className="screen opening-screen">
      {setting.gameMedia.src !== '' && (
        <div className="screen-background">
          <MediaPlayer src={setting.gameMedia.src} asBackground />
        </div>
      )}
      <div className="screen-content">
        {setting.logo.src !== '' && <img className="opening-logo" src={setting.logo.src} alt="" />}
        <h1 className="opening-title">{setting.titleThroughoutGame || engine.getGame().name}</h1>
        <p className="opening-hint">לחצו על רווח כדי להתחיל</p>
      </div>
    </div>
  );
}

export function WinnersScreen({
  engine,
  nameOf = identityName,
}: {
  engine: GameEngine;
  nameOf?: NameResolver;
}) {
  const setting = engine.getGame().setting;
  const winners = engine.getWinners();
  return (
    <div className="screen winners-screen">
      {setting.winnersMedia.src !== '' && (
        <div className="screen-background">
          <MediaPlayer src={setting.winnersMedia.src} asBackground />
        </div>
      )}
      <div className="screen-content">
        <h1 className="winners-title">🏆 הזוכים</h1>
        <ol className="winners-podium">
          {winners.map((winner, index) => (
            <li key={winner.voterId} className={`winner winner--${index + 1}`}>
              <span className="winner-rank">{index + 1}</span>
              <FitText className="winner-name">{nameOf(winner.voterId)}</FitText>
              <span className="winner-score">{winner.score} נק׳</span>
            </li>
          ))}
          {winners.length === 0 && <li className="winner">אין משתתפים עם ניקוד</li>}
        </ol>
        <p className="opening-hint">רווח — לרשימה המלאה</p>
      </div>
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
  // 20 שורות בשתי עמודות — נכנס בבמה הקבועה בלי גלילה
  const winners = engine.getWinners(20);
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
        <h1 className="winners-title">טבלת הניקוד המלאה</h1>
        <div className={`winners-layout${showGroups ? ' winners-layout--with-groups' : ''}`}>
          <div className="winners-col">
            <h2 className="winners-col-title">דירוג אישי</h2>
            <ol className="winners-list">
              {winners.map((winner, index) => (
                <li key={winner.voterId}>
                  <span className="winner-rank">{index + 1}.</span>
                  <FitText className="winner-name">{nameOf(winner.voterId)}</FitText>
                  <span className="winner-score">{winner.score}</span>
                </li>
              ))}
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
