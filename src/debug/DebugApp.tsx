/**
 * מסך דיבאג ל-Milestone 1 (זמני): בחירת fixture, כפתורי אירועים, תצוגת
 * ה-state כ-JSON, והזרקת VoteSnapshot ידנית. בלי עיצוב — כלי עבודה בלבד.
 */

import { useMemo, useRef, useState } from 'react';
import { GameEngine, parseGameFile, type GameFile, type VoteSnapshot } from '../engine/index.ts';
import { useEngineState } from '../app/useEngineState.ts';

import hadassah from '../../fixtures/hadassah-ozen.json';
import masaa from '../../fixtures/masaa-sync-manual-link.json';
import beficha from '../../fixtures/beficha-uvilvavcha.json';
import neuwirth from '../../fixtures/neuwirth.json';

const RAW_FIXTURES: Record<string, unknown> = {
  'hadassah-ozen': hadassah,
  'masaa-sync-manual-link': masaa,
  'beficha-uvilvavcha': beficha,
  neuwirth: neuwirth,
};

export function DebugApp() {
  const [fixtureName, setFixtureName] = useState<string>('hadassah-ozen');
  const [resetCounter, setResetCounter] = useState(0);
  const seqRef = useRef(0);

  const loaded = useMemo(() => {
    void resetCounter; // יצירת מנוע חדש בכל איפוס
    seqRef.current = 0;
    try {
      const game: GameFile = parseGameFile(RAW_FIXTURES[fixtureName]);
      return { engine: new GameEngine(game), error: null };
    } catch (e) {
      return { engine: null, error: (e as Error).message };
    }
  }, [fixtureName, resetCounter]);

  if (loaded.engine === null) {
    return (
      <div dir="rtl">
        <h1>מסך דיבאג — שגיאת טעינה</h1>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{loaded.error}</pre>
      </div>
    );
  }
  return <EngineDebugger key={`${fixtureName}-${resetCounter}`} engine={loaded.engine}
    fixtureName={fixtureName}
    onFixtureChange={(name) => setFixtureName(name)}
    onReset={() => setResetCounter((n) => n + 1)}
    seqRef={seqRef}
  />;
}

function EngineDebugger({
  engine,
  fixtureName,
  onFixtureChange,
  onReset,
  seqRef,
}: {
  engine: GameEngine;
  fixtureName: string;
  onFixtureChange: (name: string) => void;
  onReset: () => void;
  seqRef: React.MutableRefObject<number>;
}) {
  const state = useEngineState(engine);
  const [snapshotText, setSnapshotText] = useState('');
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [gotoId, setGotoId] = useState('');
  const [serialized, setSerialized] = useState<string | null>(null);

  const slide = engine.getCurrentSlide();

  const dispatch = (type: 'ADVANCE' | 'BACK' | 'VOTING_TIMEOUT' | 'MEDIA_ENDED') => {
    engine.dispatch({ type, at: Date.now() });
  };

  const fillSampleSnapshot = () => {
    const voters: Record<string, number> = {};
    const counts: Record<string, number> = {};
    const answers = slide.question.answers;
    ['alice', 'bob', 'carol'].forEach((voter, i) => {
      const answer = answers[i % Math.max(1, answers.length)];
      if (!answer) return;
      voters[voter] = answer.id;
      counts[String(answer.id)] = (counts[String(answer.id)] ?? 0) + 1;
    });
    const sample: VoteSnapshot = {
      seq: seqRef.current + 1,
      slideId: slide.id,
      counts,
      total: Object.keys(voters).length,
      voters,
      ...(Object.keys(voters).length > 0 ? { firstVoter: Object.keys(voters)[0]! } : {}),
    };
    setSnapshotText(JSON.stringify(sample, null, 2));
  };

  const injectSnapshot = () => {
    try {
      const snapshot = JSON.parse(snapshotText) as VoteSnapshot;
      seqRef.current = Math.max(seqRef.current, snapshot.seq);
      engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot, at: Date.now() });
      setSnapshotError(null);
    } catch (e) {
      setSnapshotError((e as Error).message);
    }
  };

  return (
    <div dir="rtl" style={{ fontFamily: 'monospace', padding: 16 }}>
      <h1>Trivia Engine — מסך דיבאג (M1)</h1>

      <p>
        <label>
          קובץ משחק:{' '}
          <select value={fixtureName} onChange={(e) => onFixtureChange(e.target.value)}>
            {Object.keys(RAW_FIXTURES).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>{' '}
        <button onClick={onReset}>איפוס משחק</button>
      </p>

      <p>
        <button onClick={() => dispatch('ADVANCE')}>ADVANCE ⏭</button>{' '}
        <button onClick={() => dispatch('BACK')}>BACK ⏮</button>{' '}
        <button onClick={() => dispatch('VOTING_TIMEOUT')}>VOTING_TIMEOUT ⏱</button>{' '}
        <button onClick={() => dispatch('MEDIA_ENDED')}>MEDIA_ENDED 🎬</button>{' '}
        <label>
          GOTO:{' '}
          <input
            style={{ width: 60 }}
            value={gotoId}
            onChange={(e) => setGotoId(e.target.value)}
            placeholder="slideId"
          />
        </label>{' '}
        <button
          onClick={() => {
            const slideId = Number(gotoId);
            if (Number.isFinite(slideId)) {
              engine.dispatch({ type: 'GOTO', slideId, at: Date.now() });
            }
          }}
        >
          קפוץ
        </button>
      </p>

      <h2>
        שקופית {state.currentSlideIndex + 1}/{engine.getGame().questions.length} (id=
        {state.currentSlideId}, {slide.type}) — phase: {state.phase}
      </h2>
      <p style={{ whiteSpace: 'pre-wrap' }}>{slide.question.que || '(ללא טקסט)'}</p>

      <details open>
        <summary>הזרקת VoteSnapshot ידנית</summary>
        <p>
          <button onClick={fillSampleSnapshot}>מלא דוגמה לשקופית הנוכחית</button>{' '}
          <button onClick={injectSnapshot}>הזרק ⚡</button>
        </p>
        <textarea
          rows={10}
          cols={60}
          dir="ltr"
          value={snapshotText}
          onChange={(e) => setSnapshotText(e.target.value)}
          placeholder='{"seq":1,"slideId":1,"counts":{"1":2},"total":2,"voters":{"alice":1}}'
        />
        {snapshotError && <p style={{ color: 'red' }}>שגיאה: {snapshotError}</p>}
      </details>

      <details>
        <summary>serialize / זוכים</summary>
        <p>
          <button onClick={() => setSerialized(JSON.stringify(engine.serialize(), null, 2))}>
            serialize()
          </button>
        </p>
        {serialized && <pre dir="ltr">{serialized}</pre>}
        <p>מובילים: {JSON.stringify(engine.getWinners())}</p>
      </details>

      <h2>State</h2>
      <pre dir="ltr" style={{ background: '#f2f2f2', padding: 8, overflowX: 'auto' }}>
        {JSON.stringify(state, null, 2)}
      </pre>
    </div>
  );
}
