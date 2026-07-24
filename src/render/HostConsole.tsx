/**
 * "מסך המנחה" — קונסולת שליטה ויזואלית נפרדת (טאב/חלון נוסף באותו מחשב).
 * מקבל תמונות-מצב מהמסך הגדול (התצוגה) דרך ערוץ השליטה, ושולח אליו פקודות:
 * קדימה/אחורה, פקודות מנחה (1..6), דילוג (N), וקפיצה לכל שקופית. כולל צפייה
 * בהצבעות חיות ובמובילים, וניהול שמות/קבוצות תוך כדי משחק (משותף ל-localStorage).
 *
 * זהו שלב א׳: שליטה + מעקב + קפיצה + שמות/קבוצות. עריכת שקופיות (הוספה/הסרה/
 * עריכה/סדר) תתווסף בשלב ב׳ מעל אותו ערוץ.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  openControlChannel,
  type ControlChannel,
  type HostStateSnapshot,
} from '../app/controlChannel.ts';
import { loadRoster, saveRoster, type RosterData } from '../app/roster.ts';
import { RosterPanel } from './RosterPanel.tsx';

/** אייקון לפי סוג שקופית (לתצוגה מהירה ברשימה). */
const TYPE_ICON: Record<string, string> = {
  trivia: '❓',
  survey: '📊',
  poll: '📊',
  ans_images: '🖼️',
  subject: '📺',
  function: '⚙️',
};

const STAGE_LABEL: Record<string, string> = {
  opening: 'לפני התחלה',
  playing: 'במשחק',
  winners: 'מנצחים',
  scoreboard: 'טבלת ניקוד',
};
const PHASE_LABEL: Record<string, string> = {
  showing: 'הצגה',
  voting: 'הצבעה',
  results: 'חשיפת תשובה',
  ended: 'הסתיים',
};

export function HostConsole() {
  const [snap, setSnap] = useState<HostStateSnapshot | null>(null);
  const [view, setView] = useState<'control' | 'roster'>('control');
  const [roster, setRosterState] = useState<RosterData>({ players: [], categories: [], memberships: {} });
  const chRef = useRef<ControlChannel | null>(null);
  const gameIdRef = useRef<string>('');

  useEffect(() => {
    const ch = openControlChannel((msg) => {
      if (msg.t !== 'state') return; // המסך הזה מציג רק תמונות-מצב
      setSnap(msg);
      // מרשם משותף ב-localStorage (אותו origin) — טוענים כשמזהה המשחק מתעדכן.
      if (msg.gameId !== gameIdRef.current) {
        gameIdRef.current = msg.gameId;
        setRosterState(loadRoster(msg.gameId));
      }
    });
    chRef.current = ch;
    ch.post({ t: 'hello' }); // מבקשים מהתצוגה לפרסם את מצבה הנוכחי
    return () => {
      ch.close();
      chRef.current = null;
    };
  }, []);

  const post = chRef.current?.post ?? (() => {});
  const cmd = (c: 'advance' | 'back' | 'nextSlide') => post({ t: 'cmd', cmd: c });
  const host = (n: number) => post({ t: 'host', n });
  const goto = (slideId: number) => post({ t: 'goto', slideId });

  const updateRoster = (next: RosterData) => {
    setRosterState(next);
    if (gameIdRef.current !== '') saveRoster(gameIdRef.current, next);
    post({ t: 'roster' }); // מודיעים לתצוגה לטעון מחדש
  };

  // רמזי מקשים לפי השלב (מוצג ליד הכפתורים כדי לזכור מה כל אחד עושה).
  const inResults = snap?.phase === 'results';
  const inVoting = snap?.phase === 'voting';

  const leaders = useMemo(() => snap?.leaders ?? [], [snap]);

  if (snap === null) {
    return (
      <div className="hc-root hc-waiting" dir="rtl">
        <div className="hc-waiting-box">
          <div className="hc-waiting-spin" />
          <h1>מסך המנחה</h1>
          <p>ממתין לחיבור עם המסך הראשי…</p>
          <p className="hc-waiting-hint">ודאו שהמשחק פתוח בחלון/טאב הראשי על מחשב זה.</p>
        </div>
      </div>
    );
  }

  if (view === 'roster') {
    return (
      <div className="hc-root" dir="rtl">
        <RosterPanel
          roster={roster}
          onChange={updateRoster}
          onClose={() => setView('control')}
          onOpenConnect={() => {
            /* מסך ההתחברות נפתח מהמסך הגדול; כאן מנהלים שמות/קבוצות בלבד */
          }}
        />
      </div>
    );
  }

  return (
    <div className="hc-root" dir="rtl">
      <header className="hc-head">
        <div className="hc-title">
          <span className="hc-title-name">{snap.gameName || 'משחק'}</span>
          <span className="hc-badges">
            <span className="hc-badge">{STAGE_LABEL[snap.stage] ?? snap.stage}</span>
            {snap.stage === 'playing' && (
              <span className="hc-badge hc-badge--phase">{PHASE_LABEL[snap.phase] ?? snap.phase}</span>
            )}
          </span>
        </div>
        <button className="hc-tab" onClick={() => setView('roster')}>
          👥 שמות וקבוצות
        </button>
      </header>

      <div className="hc-body">
        {/* רשימת השקופיות — לחיצה קופצת ישירות לשקופית */}
        <section className="hc-slides">
          <h2 className="hc-section-title">שקופיות ({snap.slides.length})</h2>
          <ol className="hc-slide-list">
            {snap.slides.map((s) => (
              <li key={s.id}>
                <button
                  className={`hc-slide${s.id === snap.currentSlideId ? ' hc-slide--current' : ''}`}
                  onClick={() => goto(s.id)}
                  disabled={snap.stage !== 'playing'}
                  title={snap.stage !== 'playing' ? 'קפיצה זמינה במהלך המשחק' : 'קפיצה לשקופית'}
                >
                  <span className="hc-slide-num">{s.index + 1}</span>
                  <span className="hc-slide-icon">{TYPE_ICON[s.type] ?? '•'}</span>
                  <span className="hc-slide-que">{s.que || '(ללא כותרת)'}</span>
                  {s.id === snap.currentSlideId && <span className="hc-slide-now">עכשיו</span>}
                </button>
              </li>
            ))}
          </ol>
        </section>

        {/* פקודות + מעקב חי */}
        <section className="hc-side">
          <div className="hc-controls">
            <h2 className="hc-section-title">שליטה</h2>
            <div className="hc-btn-row">
              <button className="hc-btn hc-btn--back" onClick={() => cmd('back')}>◀ אחורה</button>
              <button className="hc-btn hc-btn--fwd" onClick={() => cmd('advance')}>קדימה ▶</button>
            </div>
            <div className="hc-btn-grid">
              <button className="hc-btn" onClick={() => host(1)}>🏆 טבלת מובילים</button>
              <button className="hc-btn" onClick={() => host(3)}>👏 מחיאות כפיים</button>
              {inResults && <button className="hc-btn" onClick={() => host(4)}>📊 דירוג קבוצות</button>}
              {inResults && <button className="hc-btn" onClick={() => host(5)}>📋 פירוט הצבעות</button>}
              {inVoting && <button className="hc-btn" onClick={() => host(4)}>⏱ +10 שניות</button>}
              {inVoting && <button className="hc-btn" onClick={() => host(5)}>⏱ −10 שניות</button>}
              {inVoting && <button className="hc-btn" onClick={() => host(6)}>⏸ השהיה / המשך</button>}
              <button className="hc-btn hc-btn--skip" onClick={() => cmd('nextSlide')}>⏭ דילוג לשקופית הבאה</button>
            </div>
          </div>

          <div className="hc-live">
            <h2 className="hc-section-title">מעקב חי</h2>
            <div className="hc-live-stats">
              <div className="hc-stat">
                <span className="hc-stat-num">{snap.votesTotal}</span>
                <span className="hc-stat-lbl">הצביעו{snap.connected > 0 ? ` / ${snap.connected}` : ''}</span>
              </div>
            </div>
            <h3 className="hc-live-sub">מובילים</h3>
            <ol className="hc-leaders">
              {leaders.length === 0 && <li className="hc-leader hc-leader--empty">— אין ניקוד עדיין —</li>}
              {leaders.map((l, i) => (
                <li key={`${l.name}-${i}`} className="hc-leader">
                  <span className="hc-leader-rank">{i + 1}</span>
                  <span className="hc-leader-name">{l.name}</span>
                  <span className="hc-leader-score">{l.score}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}
