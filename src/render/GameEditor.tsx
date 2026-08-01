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
import { saveEditedGame } from '../app/clickerBridge.ts';

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

      <div className="editor-body">
        {/* currentSlideId=-1: אין שקופית "בהצבעה", ולכן שום שקופית אינה נעולה */}
        <SlideEditor game={draft} currentSlideId={-1} onChange={edit} />
      </div>
    </div>
  );
}
