/**
 * עורך המשחק המקומי (אופליין) — עורך את קובץ המשחק ושומר אותו לחבילת ה-ZIP
 * שעל הדיסק, כך שהשינויים נשארים גם אחרי סגירה ופתיחה מחדש.
 *
 * עריכת השקופיות עצמן נעשית ב-SlideEditor הקיים (אותו רכיב שמשמש את מסך
 * המנחה לעריכה חיה) — כאן נוספים סביבו שדות ברמת המשחק, שמירה, ויציאה בטוחה.
 *
 * מדיה שנוספת נשמרת בשמירה *לתוך החבילה*: הכתובת הזמנית שלה תקפה לסשן הזה
 * בלבד, ובלי ההטמעה הפתיחה הבאה הייתה מציגה מדיה חסרה (ראו saveEditedGame).
 */

import { useEffect, useRef, useState } from 'react';
import type { GameFile } from '../engine/index.ts';
import { SlideEditor } from './SlideEditor.tsx';
import { SchemaFields } from './SchemaFields.tsx';
import { describeObject } from '../app/schemaForm.ts';
import { globalSettingsSchema, slideSettingsSchema } from '../engine/schema.ts';
import { saveEditedGame } from '../app/clickerBridge.ts';

/**
 * שדות שכבר נערכים בטופס הייעודי — לא מציגים אותם פעמיים. כל *שאר* השדות
 * בסכימה (כולל כאלה שיתווספו בעתיד) נגזרים אוטומטית.
 */
const SETTING_HANDLED = ['titleThroughoutGame'];

/** עץ השדות נגזר פעם אחת — הסכימה קבועה לאורך חיי התוכנה. */
const SETTING_FIELDS = describeObject(globalSettingsSchema, SETTING_HANDLED);
const SLIDE_SETTING_FIELDS = describeObject(slideSettingsSchema);

interface GameEditorProps {
  game: GameFile;
  /** שמירת הגרסה הערוכה גם בזיכרון (כדי שהמשחק שירוץ יהיה המעודכן). */
  onApply: (game: GameFile) => void;
  onClose: () => void;
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; media: number } | { kind: 'error'; message: string };

export function GameEditor({ game, onApply, onClose }: GameEditorProps) {
  const [draft, setDraft] = useState<GameFile>(game);
  const [dirty, setDirty] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  /**
   * הטיוטה האחרונה שאנחנו עצמנו החלנו כלפי מעלה. בלעדיה, onApply שאחרי שמירה
   * מחזיר לנו את אותו משחק כ-prop חדש — והאפקט שלמטה היה מאפס מיד את חיווי
   * "נשמר" ואת הטיוטה, כך שההודעה הייתה מהבהבת ונעלמת.
   */
  const appliedRef = useRef<GameFile | null>(null);
  const [tab, setTab] = useState<'slides' | 'settings' | 'slideSettings'>('slides');
  /** איזו שקופית נערכת בלשונית "הגדרות שקופית". */
  const [slideIndex, setSlideIndex] = useState(0);

  // המשחק התחלף *מבחוץ* (נטען משחק אחר) — מתחילים ממנו מחדש.
  useEffect(() => {
    if (appliedRef.current === game) return;
    setDraft(game);
    setDirty(false);
    setSave({ kind: 'idle' });
  }, [game]);

  const edit = (next: GameFile) => {
    setDraft(next);
    setDirty(true);
    setSave({ kind: 'idle' });
  };

  const doSave = async () => {
    setSave({ kind: 'saving' });
    const res = await saveEditedGame(JSON.stringify(draft));
    if (!res.ok) {
      setSave({ kind: 'error', message: res.error ?? 'השמירה נכשלה' });
      return;
    }
    setDirty(false);
    setSave({ kind: 'saved', media: res.addedMedia ?? 0 });
    appliedRef.current = draft; // שהחזרה מלמעלה לא תיראה כטעינת משחק אחר
    onApply(draft); // מהרגע הזה גם המשחק שבזיכרון הוא המעודכן
  };

  const close = () => {
    if (dirty && !window.confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?')) return;
    onClose();
  };

  return (
    <div className="screen settings-screen editor-screen">
      <div className="editor-bar">
        <div className="editor-bar-fields">
          <label className="editor-field">
            <span>שם המשחק</span>
            <input
              type="text"
              defaultValue={draft.name}
              key={`name-${game.id}`}
              onBlur={(e) => edit({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="editor-field">
            <span>כותרת קבועה</span>
            <input
              type="text"
              defaultValue={draft.setting.titleThroughoutGame}
              key={`title-${game.id}`}
              onBlur={(e) =>
                edit({
                  ...draft,
                  setting: { ...draft.setting, titleThroughoutGame: e.target.value },
                })
              }
            />
          </label>
        </div>
        <div className="editor-bar-actions">
          {save.kind === 'saved' && (
            <span className="editor-saved">
              ✅ נשמר{save.media > 0 ? ` · ${save.media} קובצי מדיה הוטמעו` : ''}
            </span>
          )}
          {save.kind === 'error' && <span className="editor-error">{save.message}</span>}
          <button
            type="button"
            className="editor-save"
            onClick={() => void doSave()}
            disabled={save.kind === 'saving' || !dirty}
          >
            {save.kind === 'saving' ? 'שומר…' : '💾 שמור לקובץ המשחק'}
          </button>
          <button type="button" className="editor-close" onClick={close}>
            סגירה
          </button>
        </div>
      </div>

      <div className="editor-tabs">
        <button
          className={tab === 'slides' ? 'editor-tab editor-tab--on' : 'editor-tab'}
          onClick={() => setTab('slides')}
        >
          שקופיות
        </button>
        <button
          className={tab === 'settings' ? 'editor-tab editor-tab--on' : 'editor-tab'}
          onClick={() => setTab('settings')}
        >
          הגדרות המשחק
        </button>
        <button
          className={tab === 'slideSettings' ? 'editor-tab editor-tab--on' : 'editor-tab'}
          onClick={() => setTab('slideSettings')}
        >
          הגדרות שקופית
        </button>
      </div>

      <div className="editor-body">
        {tab === 'slides' && (
          /* currentSlideId=-1: אין שקופית "בהצבעה", ולכן שום שקופית אינה נעולה */
          <SlideEditor game={draft} currentSlideId={-1} onChange={edit} />
        )}
        {tab === 'settings' && (
          <div className="editor-pane">
            <p className="editor-hint">
              כל השדות כאן נגזרים אוטומטית מסכימת המשחק — כולל שדות שיתווספו בעתיד.
            </p>
            <SchemaFields
              nodes={SETTING_FIELDS}
              value={draft}
              onChange={edit}
              path={['setting']}
            />
          </div>
        )}
        {tab === 'slideSettings' && (
          <div className="editor-pane">
            <div className="editor-slide-pick">
              <span>שקופית</span>
              <select
                value={slideIndex}
                onChange={(e) => setSlideIndex(Number(e.target.value))}
              >
                {draft.questions.map((q, i) => (
                  <option key={q.id} value={i}>
                    {i + 1}. {q.question.que.slice(0, 40) || '(ללא כותרת)'}
                  </option>
                ))}
              </select>
            </div>
            {draft.questions[slideIndex] !== undefined && (
              <SchemaFields
                nodes={SLIDE_SETTING_FIELDS}
                value={draft}
                onChange={edit}
                path={['questions', String(slideIndex), 'setting']}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
