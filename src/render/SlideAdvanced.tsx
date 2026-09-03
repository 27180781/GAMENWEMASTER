/**
 * חלון "הגדרות שקופית מתקדמות" — מה שנפתח בכפתור ⚙ ליד נוסח השאלה, בשמות
 * ובסדר של מערכת יצירת המשחקים.
 *
 * הרשימה עצמה (מי מקבל מה) יושבת ב-slideAdvanced.ts, כדי שתהיה ניתנת לבדיקה
 * בלי DOM. כאן רק התצוגה.
 */

import { useEffect, useRef } from 'react';
import type { GameFile, Slide } from '../engine/index.ts';
import { parseGameUsers } from '../app/roster.ts';
import {
  advancedSettingsFor,
  collapseToSingleCorrect,
  gameGroupNames,
  type AdvancedSetting,
} from '../app/slideAdvanced.ts';
import { MediaField } from './SlideEditor.tsx';

/** ברירות המחדל שהעורך המקוון מציג כשמדליקים מתג (ראו SLIDESETTINGS.md §4). */
const DEFAULT_SKIP_SECONDS = 10;
const DEFAULT_REDUCTION_SECONDS = 30;
const DEFAULT_REDUCTION_SCORE = 0;

/** מתג הפעלה/כיבוי — שורה עם תווית מימין ומתג משמאל, כמו באונליין. */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="sa-row">
      <span className="sa-row-label">{label}</span>
      <input
        type="checkbox"
        className="sa-switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** תיבת מספר קטנה שנפתחת מתחת למתג דלוק (שניות / ניקוד). */
function NumBox({
  label,
  value,
  min,
  max,
  onSet,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onSet: (n: number) => void;
}) {
  return (
    <label className="sa-num">
      <span>{label}</span>
      <input
        type="number"
        dir="ltr"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onSet(Number(e.target.value) || 0)}
      />
    </label>
  );
}

interface SlideAdvancedProps {
  game: GameFile;
  slide: Slide;
  patch: (updater: (s: Slide) => Slide) => void;
  /** האם טופס התשובות נמצא כרגע במצב "מספר תשובות נכונות". */
  multiCorrect: boolean;
  onMultiCorrect: (on: boolean) => void;
  onClose: () => void;
}

export function SlideAdvanced({
  game,
  slide,
  patch,
  multiCorrect,
  onMultiCorrect,
  onClose,
}: SlideAdvancedProps) {
  const shown = new Set<AdvancedSetting>(advancedSettingsFor(slide.type));
  const groups = gameGroupNames(parseGameUsers(game.users));
  const setting = slide.setting;
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc סוגר, והמיקוד נכנס לחלון — אחרת המקלדת נשארת בטופס שמאחור.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** עדכון שדה בתוך setting, בלי לגעת בשאר השדות שהקובץ נושא. */
  const setSetting = (part: Partial<Slide['setting']>) =>
    patch((s) => ({ ...s, setting: { ...s.setting, ...part } }));

  return (
    <div className="sa-backdrop" onClick={onClose} role="presentation">
      <div
        className="sa-modal"
        role="dialog"
        aria-modal="true"
        aria-label="הגדרות שקופית מתקדמות"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sa-head">
          <h2 className="sa-title">הגדרות שקופית מתקדמות</h2>
          <button ref={closeRef} type="button" className="sa-close" onClick={onClose} title="סגירה">
            ✕
          </button>
        </div>

        <div className="sa-body">
          {shown.has('multiCorrect') && (
            <>
              <Toggle
                label="אפשר מספר תשובות נכונות"
                checked={multiCorrect}
                onChange={(on) => {
                  // הדלקה אינה משנה את הקובץ — היא פותחת סימון מרובה בטופס
                  // התשובות. כיבוי חוזר לתשובה הנכונה הראשונה, כמו באונליין.
                  onMultiCorrect(on);
                  if (!on) patch(collapseToSingleCorrect);
                }}
              />
              <p className="sa-hint">
                כשדולק אפשר לסמן יותר מתשובה אחת כנכונה בטופס התשובות, וכל מי
                שבחר באחת מהן מקבל את מלוא הניקוד.
              </p>
            </>
          )}

          {shown.has('groupRestriction') && (
            <div className="sa-field">
              <span className="sa-row-label">שיוך השאלה לקבוצה</span>
              <select
                className="sa-select"
                value={setting.groupRestriction?.active === true ? setting.groupRestriction.groupName : ''}
                onChange={(e) =>
                  setSetting({
                    groupRestriction:
                      e.target.value === ''
                        ? { active: false, groupName: '' }
                        : { active: true, groupName: e.target.value },
                  })
                }
              >
                <option value="">כל המשתתפים</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <p className="sa-hint">
                {groups.length === 0
                  ? 'אין עדיין קבוצות במשחק — אפשר לשייך משתתפים לקבוצות במסך המשתתפים.'
                  : 'רק משתתפי הקבוצה שנבחרה יוכלו לענות על שקופית זו.'}
              </p>
            </div>
          )}

          {shown.has('allowChangeVote') && (
            <Toggle
              label="אפשר שינוי תשובה"
              checked={setting.allowChangeVote}
              onChange={(on) => setSetting({ allowChangeVote: on })}
            />
          )}

          {shown.has('firstClicker') && (
            <Toggle
              label="הראשון שעונה מנצח"
              checked={setting.firstClicker}
              onChange={(on) => setSetting({ firstClicker: on })}
            />
          )}

          {shown.has('automaticSkip') && (
            <>
              <Toggle
                label="מעבר אוטומטי"
                checked={setting.automaticSkip.active}
                onChange={(on) =>
                  setSetting({
                    automaticSkip: {
                      active: on,
                      seconds:
                        setting.automaticSkip.seconds > 0
                          ? setting.automaticSkip.seconds
                          : DEFAULT_SKIP_SECONDS,
                    },
                  })
                }
              />
              {setting.automaticSkip.active && (
                <NumBox
                  label="אחרי כמה שניות"
                  value={setting.automaticSkip.seconds}
                  min={1}
                  max={300}
                  onSet={(n) => setSetting({ automaticSkip: { active: true, seconds: n } })}
                />
              )}
            </>
          )}

          {shown.has('slidBackgroundMedia') && (
            <div className="sa-field">
              <span className="sa-row-label">רקע ספציפי לשקופית זו בלבד</span>
              <MediaField
                label=""
                value={setting.slidBackgroundMedia.src}
                onSet={(url) => setSetting({ slidBackgroundMedia: { src: url } })}
              />
            </div>
          )}

          {shown.has('scoringReduction') && (
            <>
              <Toggle
                label="הפחתת ניקוד עם הזמן"
                checked={setting.scoringReduction.active}
                onChange={(on) =>
                  setSetting({
                    scoringReduction: {
                      active: on,
                      seconds:
                        setting.scoringReduction.seconds > 0
                          ? setting.scoringReduction.seconds
                          : DEFAULT_REDUCTION_SECONDS,
                      score: setting.scoringReduction.score || DEFAULT_REDUCTION_SCORE,
                    },
                  })
                }
              />
              {setting.scoringReduction.active && (
                <div className="sa-num-row">
                  <NumBox
                    label="כל כמה שניות"
                    value={setting.scoringReduction.seconds}
                    min={1}
                    max={300}
                    onSet={(n) =>
                      setSetting({ scoringReduction: { ...setting.scoringReduction, seconds: n } })
                    }
                  />
                  <NumBox
                    label="כמה נקודות להפחית"
                    value={setting.scoringReduction.score}
                    min={0}
                    max={100}
                    onSet={(n) =>
                      setSetting({ scoringReduction: { ...setting.scoringReduction, score: n } })
                    }
                  />
                </div>
              )}
            </>
          )}
        </div>

        <button type="button" className="sa-done" onClick={onClose}>
          סיום
        </button>
      </div>
    </div>
  );
}
