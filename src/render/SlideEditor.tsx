/**
 * עורך שקופיות חי למסך המנחה (שלב ב׳). עורך את המשחק המקומי ומעביר כל שינוי
 * למעלה (onChange) — משם הוא נשלח לתצוגה שמריצה hot-swap. עריכה לסשן בלבד.
 *
 * מדיה: קישור (URL) עובד תמיד. "בחר מהמחשב" — באופליין שומר לדיסק (trivia-media://),
 * ובאונליין מטמיע תמונה קטנה כ-data URL (וידאו/קובץ גדול באונליין — רק קישור).
 */

import { useEffect, useState } from 'react';
import type { GameFile, Slide } from '../engine/index.ts';
import {
  addAnswer,
  addSlide,
  duplicateSlide,
  moveSlide,
  removeAnswer,
  removeSlide,
  setCorrect,
  updateSlide,
} from '../app/slideEdit.ts';
import { canAddMediaFile, desktopMediaAddFile } from '../app/clickerBridge.ts';

const VOTABLE = new Set(['trivia', 'survey', 'ans_images']);
/** גבול לתמונה מוטמעת כ-data URL באונליין (מעבר לכך — רק קישור). */
const MAX_INLINE_IMAGE = 1_800_000;

interface SlideEditorProps {
  game: GameFile;
  currentSlideId: number;
  /**
   * שלב המשחק בתצוגה. בזמן הצבעה פעילה השקופית הנוכחית נעולה לעריכה: שינוי
   * תשובות באמצע ההצבעה היה מבלבל את ספירת הקולות של אותה שאלה (הקולות מוצלבים
   * לפי מיקום התשובה). שאר השקופיות פתוחות לעריכה כרגיל.
   */
  phase?: string;
  onChange: (game: GameFile) => void;
}

/** שדה מדיה: קלט קישור + כפתור "בחר מהמחשב" (לפי הסביבה). */
function MediaField({ label, value, onSet }: { label: string; value: string; onSet: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const pick = async (file: File) => {
    setNote('');
    if (canAddMediaFile()) {
      // אופליין (EXE) — נשמר לתיקיית המדיה ומוגש כ-trivia-media://
      setBusy(true);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const url = await desktopMediaAddFile(file.name, bytes);
      setBusy(false);
      if (url) onSet(url);
      else setNote('שמירת הקובץ נכשלה.');
      return;
    }
    // אונליין — תמונה קטנה כ-data URL; אחרת מפנים לקישור.
    if (!file.type.startsWith('image/') || file.size > MAX_INLINE_IMAGE) {
      setNote('אונליין: לקובץ גדול/וידאו השתמשו בקישור (URL).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onSet(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  };

  return (
    <div className="se-media">
      <label className="se-label">{label}</label>
      <div className="se-media-row">
        <input
          className="se-input"
          type="text"
          dir="ltr"
          placeholder="קישור (URL) או data:"
          defaultValue={value}
          key={value}
          onBlur={(e) => onSet(e.target.value.trim())}
        />
        <label className="se-file-btn">
          {busy ? '…' : '📁 מהמחשב'}
          <input
            type="file"
            accept="image/*,video/*,audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {note && <p className="se-note">{note}</p>}
    </div>
  );
}

export function SlideEditor({ game, currentSlideId, phase, onChange }: SlideEditorProps) {
  const [selected, setSelected] = useState(0);
  // כשמתחלף המשחק (הד מהתצוגה) — משאירים את הבחירה בטווח.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, game.questions.length - 1)));
  }, [game.questions.length]);

  const slide: Slide | undefined = game.questions[selected];
  const votable = slide ? VOTABLE.has(slide.type) : false;
  /** השקופית שמוצגת כרגע בהצבעה פעילה — נעולה לעריכה עד סיום ההצבעה. */
  const locked = phase === 'voting' && slide !== undefined && slide.id === currentSlideId;
  const patch = (updater: (s: Slide) => Slide) => {
    if (locked) return;
    onChange(updateSlide(game, selected, updater));
  };
  /** מחיקה/סדר של השקופית שבהצבעה חסומים גם הם. */
  const lockedAt = (i: number) =>
    phase === 'voting' && game.questions[i]?.id === currentSlideId;

  return (
    <div className="se-root">
      <div className="se-list-col">
        <div className="se-list-head">
          <h2 className="hc-section-title">שקופיות ({game.questions.length})</h2>
          <button className="se-add" onClick={() => onChange(addSlide(game, game.questions.length - 1))}>
            ➕ הוסף
          </button>
        </div>
        <ol className="se-list">
          {game.questions.map((q, i) => (
            <li key={q.id} className={`se-item${i === selected ? ' se-item--sel' : ''}`}>
              <button className="se-item-main" onClick={() => setSelected(i)}>
                <span className="se-item-num">{i + 1}</span>
                <span className="se-item-que">{q.question.que || '(ללא כותרת)'}</span>
                {q.id === currentSlideId && <span className="se-item-now">עכשיו</span>}
              </button>
              <div className="se-item-ops">
                <button
                  title={lockedAt(i) ? 'נעול — השקופית בהצבעה' : 'למעלה'}
                  disabled={lockedAt(i)}
                  onClick={() => onChange(moveSlide(game, i, -1))}
                >
                  ⬆
                </button>
                <button
                  title={lockedAt(i) ? 'נעול — השקופית בהצבעה' : 'למטה'}
                  disabled={lockedAt(i)}
                  onClick={() => onChange(moveSlide(game, i, 1))}
                >
                  ⬇
                </button>
                <button title="שכפול" onClick={() => onChange(duplicateSlide(game, i))}>⧉</button>
                <button
                  title={lockedAt(i) ? 'נעול — השקופית בהצבעה' : 'מחיקה'}
                  className="se-del"
                  disabled={game.questions.length <= 1 || lockedAt(i)}
                  onClick={() => {
                    if (window.confirm('למחוק את השקופית?')) onChange(removeSlide(game, i));
                  }}
                >
                  🗑
                </button>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="se-form-col">
        {slide === undefined ? (
          <p className="se-empty">בחרו שקופית לעריכה</p>
        ) : (
          <fieldset className="se-form" key={slide.id} disabled={locked}>
            {locked && (
              <p className="se-locked" role="status">
                🔒 השקופית הזו נמצאת כרגע בהצבעה — העריכה ננעלה כדי לא לשבש את
                ספירת הקולות. אפשר לערוך אותה מיד בסיום ההצבעה, או לערוך שקופית אחרת.
              </p>
            )}
            <label className="se-label">שאלה / כותרת</label>
            <textarea
              className="se-input se-textarea"
              defaultValue={slide.question.que}
              key={`${slide.id}-que`}
              onBlur={(e) => patch((s) => ({ ...s, question: { ...s.question, que: e.target.value } }))}
            />

            <MediaField
              label="מדיית השאלה (תמונה/וידאו)"
              value={slide.question.src}
              onSet={(url) => patch((s) => ({ ...s, question: { ...s.question, src: url } }))}
            />
            <MediaField
              label="רקע השקופית"
              value={slide.backgroundMedia.src}
              onSet={(url) => patch((s) => ({ ...s, backgroundMedia: { src: url } }))}
            />

            <div className="se-num-row">
              <div>
                <label className="se-label">זמן (שניות)</label>
                <input
                  className="se-input se-num"
                  type="number"
                  defaultValue={slide.question.timeForQue}
                  key={`${slide.id}-time`}
                  onBlur={(e) =>
                    patch((s) => ({ ...s, question: { ...s.question, timeForQue: Number(e.target.value) || 0 } }))
                  }
                />
              </div>
              <div>
                <label className="se-label">ניקוד</label>
                <input
                  className="se-input se-num"
                  type="number"
                  defaultValue={slide.question.scoreForQue}
                  key={`${slide.id}-score`}
                  onBlur={(e) =>
                    patch((s) => ({ ...s, question: { ...s.question, scoreForQue: Number(e.target.value) || 0 } }))
                  }
                />
              </div>
            </div>

            {votable && (
              <div className="se-answers">
                <label className="se-label">תשובות</label>
                {slide.question.answers.map((a, ai) => (
                  <div className="se-answer" key={`${slide.id}-ans-${ai}`}>
                    {slide.type === 'trivia' && (
                      <input
                        type="radio"
                        name={`correct-${slide.id}`}
                        title="התשובה הנכונה"
                        checked={a.correct}
                        onChange={() => patch((s) => setCorrect(s, ai))}
                      />
                    )}
                    <input
                      className="se-input se-answer-text"
                      defaultValue={a.ans}
                      onBlur={(e) =>
                        patch((s) => ({
                          ...s,
                          question: {
                            ...s.question,
                            answers: s.question.answers.map((x, i) =>
                              i === ai ? { ...x, ans: e.target.value } : x,
                            ),
                          },
                        }))
                      }
                    />
                    <button
                      className="se-answer-del"
                      title="הסר תשובה"
                      disabled={slide.question.answers.length <= 2}
                      onClick={() => patch((s) => removeAnswer(s, ai))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button className="se-add-answer" onClick={() => patch((s) => addAnswer(s))}>
                  ➕ הוסף תשובה
                </button>
              </div>
            )}
          </fieldset>
        )}
      </div>
    </div>
  );
}
