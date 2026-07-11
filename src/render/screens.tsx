/**
 * מסכי המסגרת (SPEC סעיף 9): פתיחה/התחברות, זוכים, רשימת זוכים.
 */

import type { GameEngine } from '../engine/index.ts';
import { MediaPlayer } from './MediaPlayer.tsx';
import type { RailPlayer } from './QuestionSlide.tsx';

/** ברירת מחדל: אם לא סופק מרשם שמות — מציגים את המספר עצמו. */
type NameResolver = (voterId: string) => string;
const identityName: NameResolver = (voterId) => voterId;

/** כמה שחקנים מוצגים במסך הלובי לכל היותר (השאר נספרים כ"+N"). */
const LOBBY_MAX_SHOWN = 60;

/**
 * מסך התחברות שחקנים (לובי) — המסך הראשון אחרי ההגדרות. מציג בזמן אמת את כל
 * מי שהתחבר למשחק (לחץ מקש כלשהו) — באונליין (סוקט) ובדמו. רווח מתחיל.
 */
export function LobbyScreen({ engine, players }: { engine: GameEngine; players: RailPlayer[] }) {
  const setting = engine.getGame().setting;
  const shown = players.slice(0, LOBBY_MAX_SHOWN);
  const extra = players.length - shown.length;
  return (
    <div className="screen lobby-screen">
      {setting.gameMedia.src !== '' && (
        <div className="screen-background">
          <MediaPlayer src={setting.gameMedia.src} asBackground />
        </div>
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
        <div className="lobby-grid">
          {shown.map((player) => (
            <div key={player.id} className="lobby-chip">
              <span className="lobby-avatar" style={{ background: player.color }}>
                {player.initial}
              </span>
              <span className="lobby-name">{player.name}</span>
            </div>
          ))}
          {extra > 0 && <div className="lobby-chip lobby-chip--more">+{extra}</div>}
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
              <span className="winner-name">{nameOf(winner.voterId)}</span>
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
}: {
  engine: GameEngine;
  nameOf?: NameResolver;
}) {
  const setting = engine.getGame().setting;
  // 20 שורות בשתי עמודות — נכנס בבמה הקבועה בלי גלילה
  const winners = engine.getWinners(20);
  return (
    <div className="screen winners-screen">
      {setting.winnersListMedia.src !== '' && (
        <div className="screen-background">
          <MediaPlayer src={setting.winnersListMedia.src} asBackground />
        </div>
      )}
      <div className="screen-content">
        <h1 className="winners-title">טבלת הניקוד המלאה</h1>
        <ol className="winners-list">
          {winners.map((winner, index) => (
            <li key={winner.voterId}>
              <span className="winner-rank">{index + 1}.</span>
              <span className="winner-name">{nameOf(winner.voterId)}</span>
              <span className="winner-score">{winner.score}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
