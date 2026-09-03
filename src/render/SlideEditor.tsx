/**
 * עריכת שקופיות. משמש בשני מקומות:
 *   • מסך המנחה — עריכה חיה תוך כדי משחק (SlideEditor: רשימה + טופס זה לצד זה).
 *   • עורך המשחק המקומי — הרשימה והטופס יושבים בעמודות נפרדות של מעטפת העורך,
 *     ולכן הם מיוצאים גם בנפרד (SlideList / SlideForm).
 *
 * מדיה: קישור (URL) עובד תמיד. "בחר מהמחשב" — באופליין שומר לדיסק (trivia-media://),
 * ובאונליין מטמיע תמונה קטנה כ-data URL (וידאו/קובץ גדול באונליין — רק קישור).
 */

import { useEffect, useState } from 'react';
import { questionLabel, type GameFile, type Slide } from '../engine/index.ts';
import {
  addAnswer,
  addSlide,
  changeSlideType,
  SLIDE_TYPES,
  duplicateSlide,
  functionFormNodes,
  moveSlide,
  normalizeFunctionSlide,
  removeAnswer,
  removeSlide,
  setCorrect,
  slideSubtitle,
  slideTypeInfo,
  updateSlide,
  VOTABLE_TYPES,
} from '../app/slideEdit.ts';
import { canAddMediaFile, desktopMediaAddFile } from '../app/clickerBridge.ts';
import { SchemaFields } from './SchemaFields.tsx';
import { describeObject } from '../app/schemaForm.ts';
import { functionConfigSchema } from '../engine/schema.ts';
import type { SlideType } from '../engine/index.ts';

/** שדות ההגדרה של שקופית "פעולת מערכת" — נגזרים מהסכימה פעם אחת. */
const FUNCTION_FIELDS = describeObject(functionConfigSchema);

/** גבול לתמונה מוטמעת כ-data URL באונליין (מעבר לכך — רק קישור). */
const MAX_INLINE_IMAGE = 1_800_000;

/** האם הכתובת נראית כווידאו — כדי להציג <video> ולא <img> בתצוגה המקדימה. */
function isVideo(src: string): boolean {
  return /^data:video|\.(mp4|webm|ogg|mov)(\?|$)/i.test(src);
}

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

/**
 * שדה מדיה: אזור תצוגה/העלאה + קישור + ניקוי. התצוגה המקדימה חשובה — בלעדיה
 * אי אפשר לדעת *מה* הקובץ שנבחר, רק שיש כזה.
 */
function MediaField({
  label,
  value,
  onSet,
}: {
  label: string;
  value: string;
  onSet: (url: string) => void;
}) {
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
      <label className="se-drop" title={value || 'בחירת קובץ מהמחשב'}>
        {busy ? (
          <span className="se-drop-empty">שומר…</span>
        ) : value === '' ? (
          <span className="se-drop-empty">＋ העלאת קובץ</span>
        ) : isVideo(value) ? (
          <video className="se-drop-preview" src={value} muted />
        ) : (
          <img className="se-drop-preview" src={value} alt="" />
        )}
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
      <div className="se-media-row">
        <input
          className="se-input se-media-url"
          type="text"
          dir="ltr"
          placeholder="קישור (URL) או data:"
          defaultValue={value}
          key={value}
          onBlur={(e) => onSet(e.target.value.trim())}
        />
        <button
          type="button"
          className="se-media-clear"
          title="ניקוי"
          disabled={value === ''}
          onClick={() => onSet('')}
        >
          ✕
        </button>
      </div>
      {note && <p className="se-note">{note}</p>}
    </div>
  );
}

/**
 * שדה מספר עם מחוון. המחוון הוא קיצור דרך בלבד — תיבת המספר לצדו מקבלת כל
 * ערך, כולל מעבר לתקרת המחוון (התקרה נמתחת לפי הערך הקיים כדי לא "לגזוז" אותו).
 */
function NumberSlider({
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
  const top = Math.max(max, value);
  return (
    <div className="se-slider">
      <label className="se-label">{label}</label>
      <div className="se-slider-row">
        <input
          className="se-range"
          type="range"
          min={min}
          max={top}
          value={value}
          onChange={(e) => onSet(Number(e.target.value))}
        />
        <input
          className="se-input se-num"
          type="number"
          dir="ltr"
          value={value}
          onChange={(e) => onSet(Number(e.target.value) || 0)}
        />
      </div>
    </div>
  );
}

/**
 * הגדרות שקופית "פעולת מערכת". הכול נגזר מ-functionConfigSchema, ולכן פעולה
 * או שדה שיתווספו לסכימה יופיעו כאן לבד. מוצג בורר הפעולה + הבלוק של הפעולה
 * הנבחרת בלבד (ראו functionFormNodes).
 */
function FunctionConfigFields({
  game,
  index,
  slide,
  onChange,
}: {
  game: GameFile;
  index: number;
  slide: Slide;
  onChange: (game: GameFile) => void;
}) {
  const base = ['questions', String(index), 'function'];
  const action = slide.function?.action ?? '';
  const { top, section } = functionFormNodes(FUNCTION_FIELDS, action);
  // בחירת פעולה אחרת מביאה איתה מיד את שדות ברירת המחדל שלה
  const change = (next: GameFile) => onChange(normalizeFunctionSlide(next, index));
  return (
    <div className="se-function">
      <SchemaFields nodes={top} value={game} onChange={change} path={base} />
      {section !== null && section.kind === 'object' && (
        <SchemaFields
          nodes={section.children}
          value={game}
          onChange={change}
          path={[...base, section.key]}
        />
      )}
    </div>
  );
}

interface SlideListProps {
  game: GameFile;
  selected: number;
  currentSlideId: number;
  phase?: string;
  onSelect: (index: number) => void;
  onChange: (game: GameFile) => void;
  /** סינון לפי חיפוש (ריק = הכול). מסונן בתצוגה בלבד — הקובץ לא נוגע. */
  filter?: string;
  /** כפתור "הוסף" מעל הרשימה. בעורך המקומי ההוספה נעשית מסרגל הסוגים. */
  showAdd?: boolean;
}

/** רשימת השקופיות — כרטיס לכל שקופית, עם פעולות סדר/שכפול/מחיקה. */
export function SlideList({
  game,
  selected,
  currentSlideId,
  phase,
  onSelect,
  onChange,
  filter = '',
  showAdd = true,
}: SlideListProps) {
  /** מחיקה/סדר של השקופית שבהצבעה חסומים — כדי לא לשבש ספירת קולות. */
  const lockedAt = (i: number) => phase === 'voting' && game.questions[i]?.id === currentSlideId;
  const needle = filter.trim().toLowerCase();
  const shown = game.questions
    .map((q, i) => ({ q, i }))
    .filter(
      ({ q }) =>
        needle === '' ||
        `${questionLabel(q.question)} ${slideSubtitle(q)}`.toLowerCase().includes(needle),
    );

  return (
    <div className="se-list-col">
      {showAdd && (
        <div className="se-list-head">
          <h2 className="hc-section-title">שקופיות ({game.questions.length})</h2>
          <button
            className="se-add"
            onClick={() => onChange(addSlide(game, game.questions.length - 1))}
          >
            ➕ הוסף
          </button>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="se-list-empty">
          {needle === '' ? 'אין עדיין שקופיות.' : 'לא נמצאו שקופיות מתאימות.'}
        </p>
      ) : (
        <ol className="se-list">
          {shown.map(({ q, i }) => {
            const info = slideTypeInfo(q.type);
            return (
              <li key={q.id} className={`se-item${i === selected ? ' se-item--sel' : ''}`}>
                <button className="se-item-main" onClick={() => onSelect(i)}>
                  <span className="se-item-icon" title={info.label}>
                    {info.icon}
                  </span>
                  <span className="se-item-num">{i + 1}</span>
                  <span className="se-item-txt">
                    <span className="se-item-que">
                      {questionLabel(q.question, '(ללא כותרת)')}
                    </span>
                    <span className="se-item-sub">{slideSubtitle(q)}</span>
                  </span>
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
                  <button title="שכפול" onClick={() => onChange(duplicateSlide(game, i))}>
                    ⧉
                  </button>
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
            );
          })}
        </ol>
      )}
    </div>
  );
}

interface SlideFormProps {
  game: GameFile;
  selected: number;
  currentSlideId: number;
  phase?: string;
  onChange: (game: GameFile) => void;
  /** תוכן נוסף בתחתית הטופס (בעורך המקומי — הגדרות השקופית מהסכימה). */
  footer?: React.ReactNode;
}

/** טופס עריכת השקופית הנבחרת. */
export function SlideForm({
  game,
  selected,
  currentSlideId,
  phase,
  onChange,
  footer,
}: SlideFormProps) {
  const slide: Slide | undefined = game.questions[selected];
  const votable = slide ? VOTABLE_TYPES.has(slide.type) : false;
  /** השקופית שמוצגת כרגע בהצבעה פעילה — נעולה לעריכה עד סיום ההצבעה. */
  const locked = phase === 'voting' && slide !== undefined && slide.id === currentSlideId;
  const patch = (updater: (s: Slide) => Slide) => {
    if (locked) return;
    onChange(updateSlide(game, selected, updater));
  };

  if (slide === undefined) {
    return (
      <div className="se-form-col">
        <p className="se-empty">בחרו שקופית לעריכה, או הוסיפו חדשה מסרגל הסוגים.</p>
      </div>
    );
  }

  const info = slideTypeInfo(slide.type);
  // מה שנשמר בקובץ, לא מה שמוצג בפועל: בעורך רוצים לראות "תמונה" גם לפני
  // שנבחרה תמונה — אחרת הלחיצה על הכפתור לא הייתה מראה כלום.
  const queMode = slide.question.queMode === 'image' ? 'image' : 'text';
  return (
    <div className="se-form-col">
      <fieldset className="se-form" key={slide.id} disabled={locked}>
        {locked && (
          <p className="se-locked" role="status">
            🔒 השקופית הזו נמצאת כרגע בהצבעה — העריכה ננעלה כדי לא לשבש את
            ספירת הקולות. אפשר לערוך אותה מיד בסיום ההצבעה, או לערוך שקופית אחרת.
          </p>
        )}

        <div className="se-head">
          <span className="se-chip">
            {info.icon} {info.label}
          </span>
          <h2 className="se-head-title">שקופית {selected + 1}</h2>
          <select
            className="se-input se-type"
            title="שינוי סוג השקופית"
            value={slide.type}
            onChange={(e) => {
              if (locked) return;
              onChange(changeSlideType(game, selected, e.target.value as SlideType));
            }}
          >
            {SLIDE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.icon} {t.label}
              </option>
            ))}
          </select>
        </div>
        <p className="se-type-hint">{info.hint}</p>

        {/* נוסח השאלה: טקסט או תמונה. במצב תמונה זהו אותו שדה src של תמונת
            השאלה — ולכן הוא נערך כאן, במקום נוסח השאלה, ולא פעמיים. */}
        <div className="se-que-head">
          <label className="se-label">שאלה / כותרת</label>
          <div className="se-que-mode" role="group" aria-label="נוסח השאלה">
            {(
              [
                ['text', 'טקסט'],
                ['image', 'תמונה'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={queMode === mode ? 'se-que-mode-btn on' : 'se-que-mode-btn'}
                onClick={() =>
                  patch((s) => ({ ...s, question: { ...s.question, queMode: mode } }))
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {queMode === 'image' ? (
          <>
            <MediaField
              label=""
              value={slide.question.src}
              onSet={(url) => patch((s) => ({ ...s, question: { ...s.question, src: url } }))}
            />
            <p className="se-type-note">
              התמונה תוצג במשחק במקום נוסח השאלה. התשובות, הזמן והניקוד נשארים כרגיל.
            </p>
          </>
        ) : (
          <textarea
            className="se-input se-textarea"
            defaultValue={slide.question.que}
            key={`${slide.id}-que`}
            onBlur={(e) => patch((s) => ({ ...s, question: { ...s.question, que: e.target.value } }))}
          />
        )}

        {!votable && slide.type !== 'function' && (
          <p className="se-type-note">
            בשקופית מסוג זה אין הצבעה, ולכן אין תשובות. התשובות שכבר נכתבו נשמרות
            ויחזרו אם תחזירו את הסוג.
          </p>
        )}

        {slide.type === 'function' && (
          <>
            <label className="se-label">הגדרות הפעולה</label>
            <FunctionConfigFields game={game} index={selected} slide={slide} onChange={onChange} />
          </>
        )}

        {votable && (
          <div className="se-answers-wrap">
            <label className="se-label">תשובות</label>
            <div className="se-answers">
              {slide.question.answers.map((a, ai) => (
                <div className="se-answer" key={`${slide.id}-ans-${ai}`}>
                  {slide.type === 'trivia' && (
                    <input
                      type="radio"
                      className="se-tick"
                      name={`correct-${slide.id}`}
                      title="התשובה הנכונה"
                      checked={a.correct}
                      onChange={() => patch((s) => setCorrect(s, ai))}
                    />
                  )}
                  {/* textarea ולא input: כדי ש-Enter יכניס שורה חדשה בתשובה,
                      כמו בשאלה. גדל לגובה התוכן ולא מוסיף פס גלילה. */}
                  <textarea
                    className="se-input se-answer-text"
                    rows={a.ans.includes('\n') ? 2 : 1}
                    placeholder={`תשובה ${ai + 1}`}
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
            </div>
            <button className="se-add-answer" onClick={() => patch((s) => addAnswer(s))}>
              ➕ הוסף תשובה
            </button>
          </div>
        )}

        <div className="se-num-row">
          <NumberSlider
            label="זמן (שניות)"
            value={slide.question.timeForQue}
            min={0}
            max={120}
            onSet={(n) => patch((s) => ({ ...s, question: { ...s.question, timeForQue: n } }))}
          />
          <NumberSlider
            label="ניקוד"
            value={slide.question.scoreForQue}
            min={0}
            max={50}
            onSet={(n) => patch((s) => ({ ...s, question: { ...s.question, scoreForQue: n } }))}
          />
        </div>

        <label className="se-label">מדיה</label>
        <div className="se-media-grid">
          {/* במצב תמונה השדה הזה כבר נערך למעלה, כנוסח השאלה. */}
          {queMode !== 'image' && (
            <MediaField
              label="מדיית השאלה"
              value={slide.question.src}
              onSet={(url) => patch((s) => ({ ...s, question: { ...s.question, src: url } }))}
            />
          )}
          <MediaField
            label="רקע השקופית"
            value={slide.backgroundMedia.src}
            onSet={(url) => patch((s) => ({ ...s, backgroundMedia: { src: url } }))}
          />
        </div>

        {footer}
      </fieldset>
    </div>
  );
}

/** רשימה + טופס זה לצד זה — התצוגה של מסך המנחה. */
export function SlideEditor({ game, currentSlideId, phase, onChange }: SlideEditorProps) {
  const [selected, setSelected] = useState(0);
  // כשמתחלף המשחק (הד מהתצוגה) — משאירים את הבחירה בטווח.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, game.questions.length - 1)));
  }, [game.questions.length]);

  return (
    <div className="se-root">
      <SlideList
        game={game}
        selected={selected}
        currentSlideId={currentSlideId}
        {...(phase === undefined ? {} : { phase })}
        onSelect={setSelected}
        onChange={onChange}
      />
      <SlideForm
        game={game}
        selected={selected}
        currentSlideId={currentSlideId}
        {...(phase === undefined ? {} : { phase })}
        onChange={onChange}
      />
    </div>
  );
}
