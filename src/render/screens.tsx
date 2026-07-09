/**
 * מסכי המסגרת (SPEC סעיף 9): פתיחה/התחברות, זוכים, רשימת זוכים.
 */

import type { GameEngine } from '../engine/index.ts';
import { MediaPlayer } from './MediaPlayer.tsx';

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

export function WinnersScreen({ engine }: { engine: GameEngine }) {
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
              <span className="winner-name">{winner.voterId}</span>
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

export function WinnersListScreen({ engine }: { engine: GameEngine }) {
  const setting = engine.getGame().setting;
  const winners = engine.getWinners(50);
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
              <span className="winner-name">{winner.voterId}</span>
              <span className="winner-score">{winner.score}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
