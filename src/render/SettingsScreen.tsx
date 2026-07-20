/**
 * מסך ההגדרות. שני מצבי תצוגה:
 *   • משחק דמה, מסך פתיחה (mode 'start' + allowDemo) — מסך אינטרו ידידותי:
 *     כרטיס הסבר "זהו משחק לדוגמא", הוראות הפעלה, כפתור "התחל משחק", וכפתור
 *     "הגדרות מתקדמות" שחושף את הגדרות הדמה המפורטות. המעברים האוטומטיים
 *     בדמה נלקחים מה-JSON.
 *   • שאר המצבים (‏⚙ באמצע משחק, או משחק אונליין אמיתי) — הטופס המלא.
 */

import { useEffect, useState } from 'react';
import type { GameFile } from '../engine/index.ts';
import { type AutoTransition, type GameSettings } from '../app/urlParams.ts';
import { MediaCachePanel } from './MediaCachePanel.tsx';

const SPEED_PRESETS: { label: string; value: number }[] = [
  { label: 'איטי — מפוזר על כל חלון ההצבעה', value: 1 },
  { label: 'רגיל — רוב ההצבעות בתחילת החלון', value: 0.6 },
  { label: 'מהיר — כולם עונים בשליש הראשון', value: 0.3 },
  { label: 'בזק — מתקפת הצבעות מיידית (בדיקת עומס)', value: 0.12 },
];

interface SettingsScreenProps {
  game: GameFile;
  initial: GameSettings;
  /** 'start' — לפני תחילת המשחק; 'ingame' — נפתח מכפתור ההגדרות בזמן משחק. */
  mode: 'start' | 'ingame';
  /** החלת ההגדרות: במסך פתיחה מתחיל משחק; באמצע משחק "המשך משחק". */
  onSave: (settings: GameSettings) => void;
  /** באמצע משחק בלבד — החלת ההגדרות והתחלת המשחק מחדש. */
  onRestart?: (settings: GameSettings) => void;
  /** משחק אונליין עם רישיון פעיל (קוד חדר) ולא אופליין — מאפשר סימון QR. */
  qrAvailable?: boolean;
  /** אופציית שחקני הדמה זמינה רק כשהקישור כולל ‎?demo=1‎; אחרת משחק אונליין רגיל. */
  allowDemo?: boolean;
  /** המשחק נטען כאופליין (ZIP/EXE) — אז לא מציגים את מסך האינטרו "משחק לדוגמא". */
  offline?: boolean;
}

export function SettingsScreen({
  game,
  initial,
  mode,
  onSave,
  onRestart,
  qrAvailable = false,
  allowDemo = false,
  offline = false,
}: SettingsScreenProps) {
  // בלי ‎?demo=1‎ אין שחקני דמה — המשחק אונליין רגיל.
  const [crowdEnabled, setCrowdEnabled] = useState(allowDemo && initial.crowdEnabled);
  const [voterCount, setVoterCount] = useState(initial.voterCount);
  const [speedFactor, setSpeedFactor] = useState(initial.speedFactor);
  const [correctPercent, setCorrectPercent] = useState(Math.round(initial.correctBias * 100));
  const [intervalMs, setIntervalMs] = useState(initial.intervalMs);
  const [hostVoterId, setHostVoterId] = useState(initial.hostVoterId);
  const [autoTransition, setAutoTransition] = useState<AutoTransition>(initial.autoTransition);
  const [showQr, setShowQr] = useState(initial.showQr);
  const [showBottomInstructions, setShowBottomInstructions] = useState(initial.showBottomInstructions);
  const [allowStartBeforeLoad, setAllowStartBeforeLoad] = useState(initial.allowStartBeforeLoad);
  /** ההגדרות המתקדמות נפתחות בחלון קופץ (מודאל) — בלי גלילה בעמוד. */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // ברירת המחדל של המעברים נטענת אסינכרונית (מה-JSON/‏localStorage) אחרי טעינת
  // המשחק — מסתנכרנים איתה כשהיא מתעדכנת, לפני שהמפעיל עורך ידנית.
  useEffect(() => {
    setAutoTransition(initial.autoTransition);
  }, [initial.autoTransition]);

  const clampedVoters = Math.min(5000, Math.max(1, Math.floor(voterCount) || 1));
  const patchAuto = (patch: Partial<AutoTransition>) =>
    setAutoTransition((a) => ({ ...a, ...patch }));
  const patchAutoImage = (patch: Partial<AutoTransition['media']['image']>) =>
    setAutoTransition((a) => ({ ...a, media: { ...a.media, image: { ...a.media.image, ...patch } } }));
  const patchAutoVideo = (playToEnd: boolean) =>
    setAutoTransition((a) => ({ ...a, media: { ...a.media, video: { playToEnd } } }));
  // QR רלוונטי רק למשחק אונליין עם רישיון שאינו דמו
  const showQrOption = qrAvailable && !crowdEnabled;
  // הפריסה נקבעת לפי סוג המשחק — זהה במסך הפתיחה ובכפתור ההגדרות שבמשחק.
  // אינטרו לדמה: משחק דמה אונליין (לא אופליין). כרטיסי טלפונים: אונליין עם קוד.
  const demoIntro = allowDemo && !offline;
  const onlinePhone = !allowDemo && qrAvailable;

  const buildSettings = (): GameSettings => ({
    crowdEnabled,
    voterCount: clampedVoters,
    speedFactor,
    correctBias: correctPercent / 100,
    intervalMs: Math.min(2000, Math.max(50, intervalMs || 300)),
    hostVoterId: hostVoterId.trim(),
    autoTransition,
    showQr: showQrOption ? showQr : false,
    showBottomInstructions,
    allowStartBeforeLoad,
  });
  const save = () => onSave(buildSettings());

  // הגדרת חסימת-הטעינה — מוצגת בשני סוגי המסכים המתקדמים (className שונה).
  const loadBlockField = (cls: string) => (
    <label className={cls}>
      <input
        type="checkbox"
        checked={allowStartBeforeLoad}
        onChange={(e) => setAllowStartBeforeLoad(e.target.checked)}
      />
      <span>אפשר להתחיל את המשחק מיד — בלי לחסום עד סיום טעינת המדיה</span>
    </label>
  );

  const limitNumber = game.setting.limit.number;
  const maxParticipants =
    limitNumber === undefined || limitNumber >= Number.MAX_SAFE_INTEGER
      ? 'ללא הגבלה'
      : limitNumber.toLocaleString();
  const HOWTO_STEPS = [
    'ודאו שיש לכם חיבור לרשת יציב לאורך המשחק',
    'חייגו למספר הטלפון והקישו את הקוד',
    'במקש רווח במקלדת תוכלו להתקדם במשחק',
    'התחילו לשחק!',
  ];

  // כפתורי הפעולה: במסך פתיחה — "התחל משחק"; באמצע משחק — "התחל מחדש" + "המשך".
  const actionButtons =
    mode === 'ingame' ? (
      <div className="settings-dual-actions">
        <button
          className="picker-button demo-start settings-restart"
          onClick={() => onRestart?.(buildSettings())}
        >
          🔄 התחלת המשחק מחדש
        </button>
        <button className="picker-button demo-start" onClick={save}>
          ▶ המשך משחק
        </button>
      </div>
    ) : (
      <button className="picker-button demo-start" onClick={save}>
        ▶ התחל משחק
      </button>
    );

  // הטופס המפורט — שתי עמודות (שחקנים והצבעה · מעברים אוטומטיים והתחברות)
  const columns = (
    <div className="demo-columns">
      <section className="demo-form demo-col">
        <div className="demo-col-title">שחקנים והצבעה</div>

        {allowDemo ? (
          <>
            <label className="demo-field demo-field--row">
              <input
                type="checkbox"
                checked={crowdEnabled}
                onChange={(e) => setCrowdEnabled(e.target.checked)}
              />
              <span>שחקני דמה (מצב דמו) — הצבעות מקהל מדומה במקום מהסוקט</span>
            </label>

            <label className="demo-field">
              <span>כמות שחקני דמה: {clampedVoters.toLocaleString()}</span>
              <div className="demo-field-inline">
                <input
                  type="range"
                  min="1"
                  max="5000"
                  step="1"
                  value={clampedVoters}
                  onChange={(e) => setVoterCount(Number(e.target.value))}
                />
                <input
                  type="number"
                  min="1"
                  max="5000"
                  value={clampedVoters}
                  onChange={(e) => setVoterCount(Number(e.target.value))}
                />
              </div>
            </label>

            <label className="demo-field">
              <span>מהירות הצבעה</span>
              <select value={speedFactor} onChange={(e) => setSpeedFactor(Number(e.target.value))}>
                {SPEED_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="demo-field">
              <span>אחוז עונים נכון (בשאלות trivia): {correctPercent}%</span>
              <input
                type="range"
                min="0"
                max="100"
                value={correctPercent}
                onChange={(e) => setCorrectPercent(Number(e.target.value))}
              />
            </label>
          </>
        ) : (
          <p className="demo-hint">משחק אונליין — השחקנים מצביעים מהטלפון/קליקר האמיתי.</p>
        )}

        <label className="demo-field">
          <span>קצב עדכוני הצבעות (ms; השרת האמיתי ≈250)</span>
          <input
            type="number"
            min="50"
            max="2000"
            step="50"
            value={intervalMs}
            onChange={(e) => setIntervalMs(Number(e.target.value))}
          />
        </label>

        <label className="demo-field">
          <span>שלט מנחה — מזהה קליקר / מספר טלפון (אופציונלי)</span>
          <input
            type="text"
            dir="ltr"
            placeholder="למשל: 0501234567"
            value={hostVoterId}
            onChange={(e) => setHostVoterId(e.target.value)}
          />
          <span className="demo-hint">
            ההקשות שלו הן פקודות מנחה (0 קדימה, 2 אחורה, 1 מובילים...) — לא משתתף בהצבעות
          </span>
        </label>

        {loadBlockField('demo-field demo-field--row')}
      </section>

      <section className="demo-form demo-col">
        <div className="demo-col-title">מעברים אוטומטיים</div>
        <label className="demo-field demo-field--row">
          <input
            type="checkbox"
            checked={autoTransition.showAnswersAfterQuestion}
            onChange={(e) => patchAuto({ showAnswersAfterQuestion: e.target.checked })}
          />
          <span>הצגת התשובות אוטומטית לאחר הצגת השאלה</span>
        </label>
        <label className="demo-field demo-field--row">
          <input
            type="checkbox"
            checked={autoTransition.startTimerAfterLastAnswer}
            onChange={(e) => patchAuto({ startTimerAfterLastAnswer: e.target.checked })}
          />
          <span>התחלת הטיימר אוטומטית לאחר התשובה האחרונה</span>
        </label>
        <label className="demo-field demo-field--row">
          <input
            type="checkbox"
            checked={autoTransition.showCorrectAnswerAfterTimer}
            onChange={(e) => patchAuto({ showCorrectAnswerAfterTimer: e.target.checked })}
          />
          <span>הצגת התשובה הנכונה אוטומטית לאחר סיום הטיימר</span>
        </label>
        <label className="demo-field demo-field--row demo-field--auto-next">
          <input
            type="checkbox"
            checked={autoTransition.nextSlide.active}
            onChange={(e) =>
              patchAuto({ nextSlide: { ...autoTransition.nextSlide, active: e.target.checked } })
            }
          />
          <span>מעבר אוטומטי לשקופית הבאה — לאחר</span>
          <input
            type="number"
            min="1"
            max="120"
            value={autoTransition.nextSlide.seconds}
            onChange={(e) =>
              patchAuto({
                nextSlide: {
                  ...autoTransition.nextSlide,
                  seconds: Math.max(1, Math.min(120, Number(e.target.value) || 6)),
                },
              })
            }
          />
          <span>שניות</span>
        </label>
        <label className="demo-field demo-field--row demo-field--auto-next">
          <input
            type="checkbox"
            checked={autoTransition.media.image.active}
            onChange={(e) => patchAutoImage({ active: e.target.checked })}
          />
          <span>מעבר אוטומטי בתמונת מדיה — לאחר</span>
          <input
            type="number"
            min="1"
            max="120"
            value={autoTransition.media.image.seconds}
            onChange={(e) =>
              patchAutoImage({ seconds: Math.max(1, Math.min(120, Number(e.target.value) || 5)) })
            }
          />
          <span>שניות</span>
        </label>
        <label className="demo-field demo-field--row">
          <input
            type="checkbox"
            checked={autoTransition.media.video.playToEnd}
            onChange={(e) => patchAutoVideo(e.target.checked)}
          />
          <span>סרטון מדיה מתנגן עד הסוף ואז עובר אוטומטית</span>
        </label>

        {showQrOption && (
          <>
            <div className="demo-col-title demo-col-title--sub">התחברות שחקנים</div>
            <label className="demo-field demo-field--row">
              <input type="checkbox" checked={showQr} onChange={(e) => setShowQr(e.target.checked)} />
              <span>הצג QR להתחברות מטלפונים חכמים</span>
            </label>
          </>
        )}
      </section>
    </div>
  );

  // שדות ההגדרות המתקדמות למשחק טלפונים (מוצגים בתוך המודאל)
  const phoneAdvancedFields = (
    <>
      <label className="online-field">
        <span>מספר פלאפון מנחה</span>
        <input type="text" dir="ltr" value={hostVoterId} onChange={(e) => setHostVoterId(e.target.value)} />
      </label>
      <p className="online-note">
        שימו לב כי פלאפון מנחה אינו יכול להשתתף במשחק והקשותיו מבצעות פעולה שונה
      </p>
      <label className="online-check">
        <input
          type="checkbox"
          checked={showBottomInstructions}
          onChange={(e) => setShowBottomInstructions(e.target.checked)}
        />
        <span>הצג הנחיות בתחתית המסך</span>
      </label>
      <label className="online-check">
        <input type="checkbox" checked={showQr} onChange={(e) => setShowQr(e.target.checked)} />
        <span>הצגת QR / קוד</span>
      </label>
      {loadBlockField('online-check')}

      {/* מעברים אוטומטיים — ברירת המחדל מקובץ המשחק, ניתנת לשינוי למשחק הזה */}
      <div className="online-subhead">מעברים אוטומטיים</div>
      <label className="online-check">
        <input
          type="checkbox"
          checked={autoTransition.showAnswersAfterQuestion}
          onChange={(e) => patchAuto({ showAnswersAfterQuestion: e.target.checked })}
        />
        <span>הצגת התשובות אוטומטית לאחר הצגת השאלה</span>
      </label>
      <label className="online-check">
        <input
          type="checkbox"
          checked={autoTransition.startTimerAfterLastAnswer}
          onChange={(e) => patchAuto({ startTimerAfterLastAnswer: e.target.checked })}
        />
        <span>התחלת הטיימר אוטומטית לאחר התשובה האחרונה</span>
      </label>
      <label className="online-check">
        <input
          type="checkbox"
          checked={autoTransition.showCorrectAnswerAfterTimer}
          onChange={(e) => patchAuto({ showCorrectAnswerAfterTimer: e.target.checked })}
        />
        <span>הצגת התשובה הנכונה אוטומטית לאחר סיום הטיימר</span>
      </label>
      <label className="online-check online-check--auto-next">
        <input
          type="checkbox"
          checked={autoTransition.nextSlide.active}
          onChange={(e) =>
            patchAuto({ nextSlide: { ...autoTransition.nextSlide, active: e.target.checked } })
          }
        />
        <span>מעבר אוטומטי לשקופית הבאה — לאחר</span>
        <input
          type="number"
          min="1"
          max="120"
          value={autoTransition.nextSlide.seconds}
          onChange={(e) =>
            patchAuto({
              nextSlide: {
                ...autoTransition.nextSlide,
                seconds: Math.max(1, Math.min(120, Number(e.target.value) || 6)),
              },
            })
          }
        />
        <span>שניות</span>
      </label>
      <label className="online-check online-check--auto-next">
        <input
          type="checkbox"
          checked={autoTransition.media.image.active}
          onChange={(e) => patchAutoImage({ active: e.target.checked })}
        />
        <span>מעבר אוטומטי בתמונת מדיה — לאחר</span>
        <input
          type="number"
          min="1"
          max="120"
          value={autoTransition.media.image.seconds}
          onChange={(e) =>
            patchAutoImage({ seconds: Math.max(1, Math.min(120, Number(e.target.value) || 5)) })
          }
        />
        <span>שניות</span>
      </label>
      <label className="online-check">
        <input
          type="checkbox"
          checked={autoTransition.media.video.playToEnd}
          onChange={(e) => patchAutoVideo(e.target.checked)}
        />
        <span>סרטון מדיה מתנגן עד הסוף ואז עובר אוטומטית</span>
      </label>
    </>
  );

  const advancedButton = (
    <button className="settings-advanced-open" onClick={() => setAdvancedOpen(true)}>
      ⚙ הגדרות מתקדמות
    </button>
  );

  // חלון קופץ (מודאל) של ההגדרות המתקדמות — גלילה פנימית, בלי גלילת עמוד
  const advancedModal = advancedOpen ? (
    <div className="settings-modal-overlay" onClick={() => setAdvancedOpen(false)}>
      <div className="settings-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>הגדרות מתקדמות</h2>
          <button className="settings-modal-close" title="סגירה" onClick={() => setAdvancedOpen(false)}>
            ✕
          </button>
        </div>
        <div className="settings-modal-body">
          {onlinePhone ? phoneAdvancedFields : columns}
          <MediaCachePanel />
        </div>
        <button className="picker-button settings-modal-done" onClick={() => setAdvancedOpen(false)}>
          סגירה
        </button>
      </div>
    </div>
  ) : null;

  // מסך אינטרו לדמה — כרטיס הסבר + הוראות + התחל משחק + הגדרות מתקדמות (מודאל)
  if (demoIntro) {
    return (
      <div className="screen settings-screen demo-intro-screen">
        <div className="screen-content demo-intro">
          <div className="demo-intro-card">
            <div className="demo-intro-bubble">
              <span className="demo-intro-bang" aria-hidden="true" />
              <div className="demo-intro-bubble-text">
                <strong>זהו משחק לדוגמא</strong>
                <p>
                  כאן תוכלו לראות איך יראה המשחק שיצרתם ולהתנסות בהפעלת המשחק עם משתתפי דמה
                  שיופיעו על המסך
                </p>
              </div>
            </div>
            <p className="demo-intro-howto">
              להפעלת המשחק דוגמא יש ללחוץ על ״התחל משחק״ ומקש רווח להתקדמות כל שלב במשחק
            </p>
          </div>

          <div className="demo-intro-actions">
            {actionButtons}
            {advancedButton}
          </div>
        </div>
        {advancedModal}
      </div>
    );
  }

  // מסך פתיחה של משחק אונליין טלפונים עם קוד בתוקף — כרטיסים לפי העיצוב
  if (onlinePhone) {
    return (
      <div className="screen settings-screen online-start-screen">
        <div className="screen-content online-start">
          {/* הוראות הפעלה בלבד — מספר הטלפון והקוד ירדו מהמסך הזה (מוצגים בבאנר
              העליון ובמסך ההתחברות). כרטיס אחד ממורכז. */}
          <div className="online-grid online-grid--single">
            <section className="online-card online-howto">
              <h2 className="online-card-title">הוראות הפעלה</h2>
              <ol className="online-steps">
                {HOWTO_STEPS.map((step, i) => (
                  <li key={i} className="online-step">
                    <span className={`online-step-num online-step-num--${i}`}>{i + 1}</span>
                    <span className="online-step-text">{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="online-max online-max--standalone">
            מספר שלטים מקסימלי להפעלה: <b>{maxParticipants}</b>
          </div>

          <div className="online-actions">
            {advancedButton}
            {actionButtons}
          </div>
        </div>
        {advancedModal}
      </div>
    );
  }

  // הטופס המלא — ⚙ באמצע משחק, או מסך פתיחה של משחק אונליין בלי קוד
  return (
    <div className="screen settings-screen">
      <div className="screen-content demo-settings">
        <h1 className="demo-title">הגדרות משחק ⚙</h1>
        <p className="demo-game-name">
          משחק: <strong>{game.name}</strong> · {game.questions.length} שקופיות
        </p>
        {columns}
        {actionButtons}
      </div>
    </div>
  );
}
