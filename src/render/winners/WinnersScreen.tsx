/**
 * מסך המנצחים הסופי — כולו בקוד (src/render/winners/), בלי וידאו: שלושה סגנונות
 * לבחירה במשחק (setting.winnersStyle, ברירת מחדל «הבמה»), בצבעי המשחק, לפי מספר
 * המנצחים בפועל (1–5). `revealed` קובע כמה מקומות נחשפו — מהמקום האחרון לראשון,
 * אחד בכל רווח של המנחה. בלעדיו (שקופית «מסך» באמצע המשחק) כולם נחשפים יחד.
 *
 * setting.winnersMedia (רקע הפודיום הישן) כבר לא מוצג: הבונה עדיין שולח אותו
 * רק בשביל מנועים ישנים.
 */

import { useContext, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { EngineView } from '../engineView.ts';
import { normalizeWinnersStyle, WINNERS_MAX } from '../../engine/winnersStyles.ts';
import { makePalette } from './core.ts';
import { WinnersRunner, specKey, type WinnersSpec } from './runner.ts';
import { WinnersSoundContext } from './soundContext.ts';
import './winners.css';

type NameResolver = (voterId: string) => string;
const identityName: NameResolver = (voterId) => voterId;

export function WinnersScreen({
  engine,
  nameOf = identityName,
  revealed,
  covered = false,
}: {
  engine: EngineView;
  nameOf?: NameResolver;
  /** כמה מקומות נחשפו (מהאחרון). בלי — כולם יחד. */
  revealed?: number;
  /** שכבה אחרת מעל המסך (דירוג הקבוצות): הכניסה מחכה שהיא תרד. */
  covered?: boolean;
}) {
  const game = engine.getGame();
  const setting = game.setting;
  const style = normalizeWinnersStyle(setting.winnersStyle);
  const spec: WinnersSpec = {
    style,
    winners: engine
      .getWinners(setting.multiWinners)
      .slice(0, WINNERS_MAX)
      .map((w) => ({ name: nameOf(w.voterId), score: w.score })),
    main: setting.mainColor,
    secondary: setting.secondaryColor,
    title: setting.titleThroughoutGame || game.name,
  };
  const key = specKey(spec);
  const count = spec.winners.length;
  const sink = useContext(WinnersSoundContext);

  const mountRef = useRef<HTMLDivElement>(null);
  const runnerRef = useRef<WinnersRunner | null>(null);
  // הערכים האחרונים, ליצירה בתוך ה-effect בלי לבנות מחדש בכל רינדור
  const latest = useRef({ spec, revealed, sink, covered });
  latest.current = { spec, revealed, sink, covered };

  const hasWinners = count > 0;
  useEffect(() => {
    const mount = mountRef.current;
    if (!hasWinners || mount === null) return undefined;
    const now = latest.current;
    const runner = new WinnersRunner(mount, now.spec, {
      revealed: now.revealed,
      sink: now.sink,
      covered: now.covered,
    });
    runnerRef.current = runner;
    return () => {
      runner.destroy();
      if (runnerRef.current === runner) runnerRef.current = null;
    };
  }, [hasWinners]);

  useEffect(() => {
    runnerRef.current?.setSpec(latest.current.spec);
  }, [key]);
  useEffect(() => {
    runnerRef.current?.setRevealed(revealed);
  }, [revealed]);
  useEffect(() => {
    runnerRef.current?.setSink(sink);
  }, [sink]);
  useEffect(() => {
    runnerRef.current?.setCovered(covered);
  }, [covered]);

  const vars = useMemo(
    () => makePalette(spec.main, spec.secondary).vars() as CSSProperties,
    [spec.main, spec.secondary],
  );
  return (
    <div
      className={`screen winners-show${hasWinners ? '' : ' is-empty'}`}
      data-style={style}
      data-count={count}
      data-revealed={revealed === undefined ? count : Math.max(0, Math.min(count, revealed))}
      style={vars}
    >
      {hasWinners ? (
        <div ref={mountRef} className="ws-mount" />
      ) : (
        <div className="screen-content">
          <p className="winners-empty">אין משתתפים עם ניקוד</p>
        </div>
      )}
    </div>
  );
}
