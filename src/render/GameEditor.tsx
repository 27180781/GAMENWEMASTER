/**
 * עורך המשחק המקומי (אופליין) — עורך את קובץ המשחק ושומר אותו לחבילת ה-ZIP
 * שעל הדיסק, כך שהשינויים נשארים גם אחרי סגירה ופתיחה מחדש.
 *
 * המבנה: סרגל עליון · עמודת הגדרות המשחק (נגזרות מהסכימה) · רשימת השקופיות ·
 * לוח העריכה של השקופית הנבחרת, עם סרגל סוגים להוספה מהירה. עריכת השקופית
 * עצמה נעשית ברכיבים המשותפים עם מסך המנחה (SlideList / SlideForm).
 *
 * מדיה שנוספת נשמרת בשמירה *לתוך החבילה*: הכתובת הזמנית שלה תקפה לסשן הזה
 * בלבד, ובלי ההטמעה הפתיחה הבאה הייתה מציגה מדיה חסרה (ראו saveEditedGame).
 */

import { useEffect, useRef, useState } from 'react';
import type { GameFile } from '../engine/index.ts';
import { SlideForm, SlideList } from './SlideEditor.tsx';
import { SchemaFields } from './SchemaFields.tsx';
import { describeObject } from '../app/schemaForm.ts';
import { globalSettingsSchema } from '../engine/schema.ts';
import {
  SETTINGS_SECTIONS,
  sectionNodes,
  unassignedSettings,
} from '../app/editorLayout.ts';
import {
  addSlideOfType,
  applyToAllSlides,
  shuffleSlides,
  SLIDE_TYPES,
  VOTABLE_TYPES,
} from '../app/slideEdit.ts';
import { saveEditedGame } from '../app/clickerBridge.ts';

/** עץ השדות נגזר פעם אחת — הסכימה קבועה לאורך חיי התוכנה. */
const SETTING_FIELDS = describeObject(globalSettingsSchema);

/**
 * שדות שאינם משויכים לאף קבוצה. בדרך כלל ריק — אבל אם יתווסף שדה לסכימה, עדיף
 * שיופיע כאן מאשר שייעלם מהעורך בשקט (ראו editorLayout.ts).
 */
const EXTRA_SETTINGS = unassignedSettings(SETTING_FIELDS);

interface GameEditorProps {
  game: GameFile;
  /** שמירת הגרסה הערוכה גם בזיכרון (כדי שהמשחק שירוץ יהיה המעודכן). */
  onApply: (game: GameFile) => void;
  onClose: () => void;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; media: number }
  | { kind: 'error'; message: string };

/**
 * "כלים" — פעולות מיידיות על כל השקופיות יחד, כמו בעורך המקוון. שתיהן משנות
 * הרבה שקופיות בבת אחת ואין להן ביטול, ולכן שתיהן מאחורי אישור.
 */
function GameTools({ game, onChange }: { game: GameFile; onChange: (g: GameFile) => void }) {
  const [time, setTime] = useState('');
  const [score, setScore] = useState('');
  const votable = game.questions.filter((q) => VOTABLE_TYPES.has(q.type)).length;

  const applyAll = () => {
    const values: { timeForQue?: number; scoreForQue?: number } = {};
    if (time.trim() !== '') values.timeForQue = Number(time);
    if (score.trim() !== '') values.scoreForQue = Number(score);
    if (values.timeForQue === undefined && values.scoreForQue === undefined) return;
    if (!window.confirm(`להחיל על ${votable} השקופיות המצביעות? הערכים הקיימים יידרסו.`)) return;
    onChange(applyToAllSlides(game, values));
    setTime('');
    setScore('');
  };

  return (
    <>
      <button
        type="button"
        className="ge-tool"
        disabled={votable < 2}
        onClick={() => {
          if (window.confirm('לערבב את סדר השאלות? אי אפשר לבטל.')) {
            onChange(shuffleSlides(game));
          }
        }}
      >
        🔀 ערבוב סדר השאלות
      </button>
      <p className="ge-hint">
        מעורבבות השאלות בלבד. שקופיות טקסט, מדיה ופונקציה נשארות במקומן.
      </p>

      <div className="ge-tool-block">
        <b>החלה על כל השקופיות</b>
        <p className="ge-hint">
          עדכון זמן מענה וניקוד לכל {votable} השאלות בבת אחת. שדה שנשאר ריק לא ישתנה.
        </p>
        <div className="ge-tool-row">
          <label className="ge-field">
            <span>זמן מענה (שניות)</span>
            <input type="number" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label className="ge-field">
            <span>ניקוד</span>
            <input type="number" dir="ltr" value={score} onChange={(e) => setScore(e.target.value)} />
          </label>
        </div>
        <button
          type="button"
          className="ge-tool"
          disabled={votable === 0 || (time.trim() === '' && score.trim() === '')}
          onClick={applyAll}
        >
          החל על כל השקופיות
        </button>
      </div>
    </>
  );
}

/** אקורדיון בעמודת ההגדרות. */
function Section({
  title,
  icon,
  open,
  children,
}: {
  title: string;
  icon: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="ge-acc" open={open === true}>
      <summary className="ge-acc-head">
        <span className="ge-acc-icon">{icon}</span>
        <span className="ge-acc-title">{title}</span>
        <span className="ge-acc-chev">⌄</span>
      </summary>
      <div className="ge-acc-body">{children}</div>
    </details>
  );
}

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
  const [selected, setSelected] = useState(0);
  const [search, setSearch] = useState('');

  // המשחק התחלף *מבחוץ* (נטען משחק אחר) — מתחילים ממנו מחדש.
  useEffect(() => {
    if (appliedRef.current === game) return;
    setDraft(game);
    setDirty(false);
    setSave({ kind: 'idle' });
  }, [game]);

  // מחיקת שקופיות עלולה להוציא את הבחירה מהטווח.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, draft.questions.length - 1)));
  }, [draft.questions.length]);

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

  /** הוספת שקופית מסוג נבחר מיד אחרי הנוכחית, ומעבר אליה. */
  const addOfType = (type: (typeof SLIDE_TYPES)[number]['value']) => {
    edit(addSlideOfType(draft, selected, type));
    setSelected(Math.min(selected + 1, draft.questions.length));
  };

  return (
    <div className="screen settings-screen editor-screen">
      <header className="ge-topbar">
        <span className="ge-mark">◎</span>
        <label className="ge-name">
          <span>שם המשחק</span>
          <input
            type="text"
            defaultValue={draft.name}
            key={`name-${game.id}`}
            onBlur={(e) => edit({ ...draft, name: e.target.value })}
          />
        </label>
        <span className="ge-state">
          {save.kind === 'saving' && 'שומר…'}
          {save.kind === 'saved' && (
            <span className="editor-saved">
              ✅ נשמר{save.media > 0 ? ` · ${save.media} קובצי מדיה הוטמעו` : ''}
            </span>
          )}
          {save.kind === 'error' && <span className="editor-error">{save.message}</span>}
          {save.kind === 'idle' && dirty && <span className="ge-dirty">● שינויים לא שמורים</span>}
        </span>
        <span className="ge-spacer" />
        <button
          type="button"
          className="editor-save"
          onClick={() => void doSave()}
          disabled={save.kind === 'saving' || !dirty}
        >
          {save.kind === 'saving' ? 'שומר…' : '💾 שמור לקובץ המשחק'}
        </button>
        <button type="button" className="editor-close" onClick={close}>
          ✕ סגירה
        </button>
      </header>

      <div className="ge-main">
        <aside className="ge-sidebar">
          <div className="ge-sidebar-scroll">
            {/* הקבוצות מוצהרות (editorLayout.ts) ולא נגזרות ממבנה ה-JSON, כדי
                שהעמודה תיראה כמו במערכת יצירת המשחקים ולא כמו הסכימה. */}
            {SETTINGS_SECTIONS.map((section, i) => (
              <Section
                key={section.id}
                title={section.title}
                icon={section.icon}
                open={i === 0}
              >
                <SchemaFields
                  nodes={sectionNodes(SETTING_FIELDS, section).filter(
                    // הגדרות סוג המשחק רלוונטיות רק כשנבחר סוג שאינו הקלאסי;
                    // אחרת זו קבוצה שלמה שאי אפשר לעשות בה כלום.
                    (n) => n.key !== 'gameTypeSettings' || draft.setting.gameType !== 'classic',
                  )}
                  value={draft}
                  onChange={edit}
                  path={['setting']}
                />
              </Section>
            ))}

            <Section title="כלים" icon="🔧">
              <GameTools game={draft} onChange={edit} />
            </Section>

            {/* רשת ביטחון: שדה שנוסף לסכימה ולא שויך לאף קבוצה — עדיף שיופיע
                כאן מאשר שייעלם מהעורך בלי שאיש ישים לב. */}
            {EXTRA_SETTINGS.length > 0 && (
              <Section title="שדות נוספים" icon="🧩">
                <SchemaFields
                  nodes={EXTRA_SETTINGS}
                  value={draft}
                  onChange={edit}
                  path={['setting']}
                />
              </Section>
            )}
          </div>
        </aside>

        <section className="ge-slides">
          <div className="ge-search">
            <span className="ge-count">
              <b>{draft.questions.length}</b>
              <span>שקופיות</span>
            </span>
            <input
              type="search"
              placeholder="חיפוש שקופית…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="ge-search-icon">🔍</span>
          </div>
          <div className="ge-cards">
            <SlideList
              game={draft}
              selected={selected}
              currentSlideId={-1}
              onSelect={setSelected}
              onChange={edit}
              filter={search}
              showAdd={false}
            />
          </div>
        </section>

        <section className="ge-editor">
          <div className="ge-typebar">
            {SLIDE_TYPES.map((t) => (
              <button
                key={t.value}
                className="ge-type"
                title={`הוספת שקופית: ${t.label} — ${t.hint}`}
                onClick={() => addOfType(t.value)}
              >
                <span className="ge-type-plus">+</span>
                <span className="ge-type-icon">{t.icon}</span>
                <span className="ge-type-label">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="ge-canvas">
            {/* currentSlideId=-1: אין שקופית "בהצבעה", ולכן שום שקופית אינה נעולה */}
            {/* הגדרות השקופית המתקדמות נפתחות בכפתור ⚙ שליד נוסח השאלה, כמו
                במערכת יצירת המשחקים — ולא כרשימת שדות שנגזרת מה-JSON. */}
            <SlideForm
              game={draft}
              selected={selected}
              currentSlideId={-1}
              onChange={edit}
              showAdvanced
            />
          </div>
        </section>
      </div>
    </div>
  );
}
