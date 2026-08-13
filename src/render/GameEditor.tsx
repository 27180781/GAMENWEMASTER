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
import { describeObject, type FieldNode } from '../app/schemaForm.ts';
import { globalSettingsSchema, slideSettingsSchema } from '../engine/schema.ts';
import { addSlideOfType, SLIDE_TYPES } from '../app/slideEdit.ts';
import { saveEditedGame } from '../app/clickerBridge.ts';

/**
 * שדות שכבר נערכים בטופס הייעודי — לא מציגים אותם פעמיים. כל *שאר* השדות
 * בסכימה (כולל כאלה שיתווספו בעתיד) נגזרים אוטומטית.
 */
const SETTING_HANDLED = ['titleThroughoutGame'];

/** עץ השדות נגזר פעם אחת — הסכימה קבועה לאורך חיי התוכנה. */
const SETTING_FIELDS = describeObject(globalSettingsSchema, SETTING_HANDLED);
const SLIDE_SETTING_FIELDS = describeObject(slideSettingsSchema);

/**
 * העמודה הצדית מסודרת כאקורדיונים. שדות "שטוחים" (צבע, מספר זוכים…) אין להם
 * קבוצה משלהם בסכימה, ולכן הם נאספים לאקורדיון אחד — כדי שהעמודה תיראה אחידה
 * ולא חצי רשימה שטוחה וחצי מקופלת.
 */
const FLAT_SETTINGS = SETTING_FIELDS.filter((n) => n.kind !== 'object');
const GROUP_SETTINGS = SETTING_FIELDS.filter((n): n is FieldNode & { kind: 'object' } =>
  n.kind === 'object',
);

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
 * אייקון לקבוצת הגדרות. קבוצה שאין לה אייקון מוכר מקבלת ברירת מחדל — כדי
 * שקבוצה שתתווסף לסכימה תיראה תקין בלי לגעת כאן.
 */
const SECTION_ICONS: Record<string, string> = {
  sound: '🔊',
  limit: '🔑',
  gameTypeSettings: '🎲',
  gameMedia: '🎬',
  logo: '🏷',
  triviaMedia: '❓',
  winnersMedia: '🏆',
  winnersListMedia: '📊',
  autoTransition: '⏭',
};
function sectionIcon(key: string): string {
  return SECTION_ICONS[key] ?? '🎛';
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
            {/* שם המשחק נערך בסרגל העליון בלבד — שני שדות לאותו ערך היו יוצאים
                מסנכרון זה עם זה. */}
            <Section title="כללי" icon="⚙️" open>
              <label className="ge-field">
                <span>כותרת קבועה במשחק</span>
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
              <SchemaFields nodes={FLAT_SETTINGS} value={draft} onChange={edit} path={['setting']} />
            </Section>

            {/* כל קבוצה בסכימה מקבלת אקורדיון משלה — קבוצה שתתווסף תופיע כאן לבד */}
            {GROUP_SETTINGS.map((node) => (
              <Section key={node.key} title={node.label} icon={sectionIcon(node.key)}>
                <SchemaFields
                  nodes={node.children}
                  value={draft}
                  onChange={edit}
                  path={['setting', node.key]}
                />
              </Section>
            ))}
          </div>
          <div className="ge-sidebar-foot">
            <p className="ge-hint">
              כל השדות כאן נגזרים אוטומטית מסכימת המשחק — כולל שדות שיתווספו בעתיד.
            </p>
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
            <SlideForm
              game={draft}
              selected={selected}
              currentSlideId={-1}
              onChange={edit}
              footer={
                draft.questions[selected] !== undefined ? (
                  <details className="ge-slide-settings">
                    <summary>הגדרות מתקדמות לשקופית</summary>
                    <SchemaFields
                      nodes={SLIDE_SETTING_FIELDS}
                      value={draft}
                      onChange={edit}
                      path={['questions', String(selected), 'setting']}
                    />
                  </details>
                ) : null
              }
            />
          </div>
        </section>
      </div>
    </div>
  );
}
