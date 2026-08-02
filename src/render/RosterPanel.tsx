/**
 * לשונית "שמות וקבוצות" — ניהול מרשם השחקנים תוך כדי משחק (חלונית בצד המסך).
 *
 *   • שמות   — רשימת מספר (קליקר/טלפון) → שם, עם הוספה/עריכה/מחיקה.
 *   • קבוצות — הגדרת קטגוריות והקבוצות שבכל אחת (ממוספרות 1..N). לכל קטגוריה
 *              אפשר לפתוח "מסך התחברות" (השחקנים מקישים את מספר הקבוצה כדי
 *              להצטרף) ולאפס את המחוברים.
 *
 * עריכת שדות טקסט מתבצעת ב-onBlur (uncontrolled) כדי לא לבנות מחדש את המבנה
 * בכל הקשה. כל שינוי עולה כלפי מעלה דרך onChange.
 */

import { useRef, useState } from 'react';
import {
  addCategory,
  addGroup,
  addPendingNames,
  categoryMemberTotal,
  changePlayerId,
  clearPendingNames,
  groupCounts,
  removeCategory,
  removeGroup,
  removePendingName,
  removePlayer,
  renameCategory,
  renameGroup,
  resetCategoryMemberships,
  upsertPlayer,
  type RosterData,
} from '../app/roster.ts';
import { importSheet, summaryText, type ImportMode } from '../app/rosterImport.ts';
import { readSheetRows } from '../app/xlsxRead.ts';

interface RosterPanelProps {
  roster: RosterData;
  onChange: (next: RosterData) => void;
  onClose: () => void;
  /** פתיחת מסך ההתחברות לקטגוריה (השחקנים מצטרפים לפי מספר הקבוצה). */
  onOpenConnect: (categoryId: string) => void;
  /** מצב "קליטה חכמה" פעיל — כל לחיצת שלט נקלטת לרשימה. */
  captureOn?: boolean;
  onToggleCapture?: (on: boolean) => void;
}

export function RosterPanel({
  roster,
  onChange,
  onClose,
  onOpenConnect,
  captureOn = false,
  onToggleCapture,
}: RosterPanelProps) {
  const [tab, setTab] = useState<'players' | 'groups'>('players');
  const [newNum, setNewNum] = useState('');
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState('');
  const [newGroup, setNewGroup] = useState<Record<string, string>>({});
  /** שמות שמוקלדים ידנית לתור ההמתנה (שורה לכל שם). */
  const [namesDraft, setNamesDraft] = useState('');
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /**
   * קלט קובץ נפרד לכל מצב ייבוא. שדה אחד עם "זכירת המצב" היה שביר: כל מסלול
   * שמגיע לקלט בלי לעבור בכפתור (כולל בדיקות) היה מייבא במצב הלא נכון.
   */
  const fullRef = useRef<HTMLInputElement | null>(null);
  const namesRef = useRef<HTMLInputElement | null>(null);

  const onFile = async (file: File | undefined, mode: ImportMode) => {
    if (file === undefined) return;
    try {
      const rows = await readSheetRows(new Uint8Array(await file.arrayBuffer()));
      const summary = importSheet(roster, rows, mode);
      onChange(summary.roster);
      setImportMsg({ ok: true, text: summaryText(summary, mode) });
    } catch {
      setImportMsg({ ok: false, text: 'לא הצלחנו לקרוא את הקובץ — נסו XLSX או CSV' });
    }
  };

  /** קלט קובץ מוסתר — נפתח מהכפתור שמעליו. */
  const fileInput = (mode: ImportMode, ref: typeof fullRef) => (
    <input
      ref={ref}
      className={mode === 'full' ? 'roster-file-full' : 'roster-file-names'}
      type="file"
      accept=".xlsx,.csv,.tsv,text/csv"
      style={{ display: 'none' }}
      onChange={(e) => {
        void onFile(e.target.files?.[0], mode);
        e.target.value = ''; // כדי שבחירת אותו קובץ שוב תפעיל שוב
      }}
    />
  );

  /** הוספת השמות שהוקלדו לתור (שורה = שם, אפשר "שם, קבוצה"). */
  const addTypedNames = () => {
    const names = namesDraft
      .split(/\r?\n/)
      .map((line) => {
        const [name = '', group = ''] = line.split(/[,\t]/);
        return { name: name.trim(), group: group.trim() };
      })
      .filter((n) => n.name !== '');
    if (names.length === 0) return;
    onChange(addPendingNames(roster, names));
    setNamesDraft('');
  };

  const waitingRemotes = roster.players.filter((p) => p.name.trim() === '').length;

  const addPlayer = () => {
    if (newNum.trim() === '') return;
    onChange(upsertPlayer(roster, newNum, newName));
    setNewNum('');
    setNewName('');
  };

  const addCat = () => {
    if (newCat.trim() === '') return;
    onChange(addCategory(roster, newCat.trim()));
    setNewCat('');
  };

  return (
    <div className="roster-panel" dir="rtl">
      <div className="roster-panel-box">
        <header className="roster-panel-header">
          <div className="roster-tabs">
            <button className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>
              🧑 שמות ({roster.players.length})
            </button>
            <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>
              👥 קבוצות ({roster.categories.length})
            </button>
          </div>
          <button className="roster-close" onClick={onClose} title="סגירה (ESC)">
            ✕
          </button>
        </header>

        {tab === 'players' && (
          <div className="roster-scroll">
            <h3 className="roster-heading">ניהול משתמשים</h3>

            {/* קלט חכם: אקסל מלא, או קליטת שלטים בלחיצה + השלמת שמות */}
            <div className="roster-import">
              <div className="roster-import-row">
                <button
                  className="roster-import-btn"
                  onClick={() => {
                    setImportMsg(null);
                    fullRef.current?.click();
                  }}
                >
                  📄 ייבוא מאקסל
                </button>
                {fileInput('full', fullRef)}
                <button
                  className={captureOn ? 'roster-capture-btn on' : 'roster-capture-btn'}
                  /* מסירים מיקוד: אחרת רווח (המקש שמקדם את המשחק) היה מפעיל
                     מחדש את הכפתור הממוקד ומכבה את הקליטה בטעות. */
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onToggleCapture?.(!captureOn);
                  }}
                  disabled={onToggleCapture === undefined}
                  title="כל לחיצה על שלט תוסיף אותו לרשימה"
                >
                  {captureOn ? '⏹ סיום קליטה' : '🎯 קליטת שלטים בלחיצה'}
                </button>
              </div>
              <p className="roster-import-hint">
                אקסל: מספר שלט · שם · קבוצה (אופציונלי). השורה הראשונה היא כותרת ואינה מיובאת —
                שם עמודת הקבוצה הופך לשם הקטגוריה.
              </p>

              {captureOn && (
                <div className="roster-capture-live">
                  🎯 הקליטה פעילה — לחצו על השלטים לפי הסדר. נקלטו {roster.players.length}
                  {waitingRemotes > 0 ? ` · ${waitingRemotes} ממתינים לשם` : ''}
                </div>
              )}

              {(captureOn || roster.pendingNames.length > 0) && (
                <div className="roster-pending">
                  <div className="roster-import-row">
                    <button
                      className="roster-import-btn"
                      onClick={() => {
                        setImportMsg(null);
                        namesRef.current?.click();
                      }}
                    >
                      📄 השלמת שמות מאקסל
                    </button>
                    {fileInput('names', namesRef)}
                    {roster.pendingNames.length > 0 && (
                      <button
                        className="roster-clear-btn"
                        onClick={() => onChange(clearPendingNames(roster))}
                      >
                        ניקוי התור
                      </button>
                    )}
                  </div>
                  <p className="roster-import-hint">
                    אקסל של שם · קבוצה בלבד (בלי מספרי שלטים). השורה הראשונה כותרת. השמות
                    משתבצים לשלטים שכבר נלחצו לפי הסדר, והעודף ממתין ללחיצות הבאות.
                  </p>
                  <textarea
                    className="roster-names-draft"
                    placeholder={'או הקלדה — שם בכל שורה\nאפשר גם: שם, קבוצה'}
                    value={namesDraft}
                    onChange={(e) => setNamesDraft(e.target.value)}
                  />
                  <button className="roster-names-add" onClick={addTypedNames}>
                    ＋ הוספה לתור
                  </button>
                  {roster.pendingNames.length > 0 && (
                    <ol className="roster-pending-list">
                      {roster.pendingNames.map((p, i) => (
                        <li key={`${p.name}-${i}`}>
                          <span>{p.name}</span>
                          {p.group !== '' && <em className="roster-pending-group">{p.group}</em>}
                          <button
                            className="roster-del"
                            title="הסרה מהתור"
                            onClick={() => onChange(removePendingName(roster, i))}
                          >
                            🗑
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {importMsg !== null && (
                <p className={importMsg.ok ? 'roster-import-ok' : 'roster-import-err'}>
                  {importMsg.text}
                </p>
              )}
            </div>

            <ul className="roster-names">
              {roster.players.map((player) => (
                <li
                  key={player.id}
                  className={
                    player.name.trim() === ''
                      ? 'roster-name-row roster-name-row--waiting'
                      : 'roster-name-row'
                  }
                >
                  <button
                    className="roster-del"
                    title="מחיקת שחקן"
                    onClick={() => onChange(removePlayer(roster, player.id))}
                  >
                    🗑
                  </button>
                  <input
                    className="roster-name-input"
                    defaultValue={player.name}
                    key={`${player.id}:${player.name}`}
                    placeholder={player.name.trim() === '' ? 'ממתין לשיוך' : 'שם השחקן'}
                    onBlur={(e) => onChange(upsertPlayer(roster, player.id, e.target.value))}
                  />
                  <input
                    className="roster-num"
                    defaultValue={player.id}
                    title="מספר קליקר/טלפון"
                    onBlur={(e) => onChange(changePlayerId(roster, player.id, e.target.value))}
                  />
                </li>
              ))}
              {roster.players.length === 0 && (
                <li className="roster-empty">אין שחקנים עדיין — הוסיפו מספר ושם למטה</li>
              )}
            </ul>

            <div className="roster-add roster-add--sticky">
              <input
                className="roster-num"
                placeholder="מספר"
                value={newNum}
                onChange={(e) => setNewNum(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
              />
              <input
                placeholder="שם חדש"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
              />
              <button className="roster-add-btn" onClick={addPlayer} title="הוספת שם">
                ＋
              </button>
            </div>
          </div>
        )}

        {tab === 'groups' && (
          <div className="roster-scroll">
            <h3 className="roster-heading">עריכת קבוצות</h3>
            <div className="roster-add">
              <input
                placeholder="שם קטגוריה חדשה (עיר, משקפיים…)"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCat()}
              />
              <button className="roster-add-btn" onClick={addCat} title="רישום קטגוריה חדשה">
                ＋
              </button>
            </div>

            {roster.categories.length === 0 && (
              <p className="roster-empty">אין קטגוריות — הוסיפו קטגוריה, ובתוכה קבוצות</p>
            )}

            {roster.categories.map((c) => {
              const counts = groupCounts(roster, c.id);
              return (
                <section key={c.id} className="roster-category">
                  <header className="roster-category-head">
                    <input
                      className="roster-cat-name"
                      defaultValue={c.name}
                      placeholder="שם הקטגוריה"
                      onBlur={(e) => onChange(renameCategory(roster, c.id, e.target.value))}
                    />
                    <span className="roster-cat-count">{categoryMemberTotal(roster, c.id)} מחוברים</span>
                    <button
                      className="roster-del"
                      title="מחיקת קטגוריה"
                      onClick={() => onChange(removeCategory(roster, c.id))}
                    >
                      🗑
                    </button>
                  </header>
                  <ul className="roster-groups">
                    {c.groups.map((g, i) => (
                      <li key={g.id}>
                        <span className="roster-group-num">{i + 1}</span>
                        <input
                          defaultValue={g.name}
                          placeholder="שם הקבוצה"
                          onBlur={(e) => onChange(renameGroup(roster, c.id, g.id, e.target.value))}
                        />
                        <span className="roster-group-count">{counts[g.id] ?? 0}</span>
                        <button
                          className="roster-del"
                          title="מחיקת קבוצה"
                          onClick={() => onChange(removeGroup(roster, c.id, g.id))}
                        >
                          🗑
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="roster-add roster-add--group">
                    <input
                      placeholder="רישום קבוצה חדשה"
                      value={newGroup[c.id] ?? ''}
                      onChange={(e) => setNewGroup((m) => ({ ...m, [c.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        const name = (newGroup[c.id] ?? '').trim();
                        if (name === '') return;
                        onChange(addGroup(roster, c.id, name));
                        setNewGroup((m) => ({ ...m, [c.id]: '' }));
                      }}
                    />
                    <button
                      className="roster-add-btn"
                      onClick={() => {
                        const name = (newGroup[c.id] ?? '').trim();
                        if (name === '') return;
                        onChange(addGroup(roster, c.id, name));
                        setNewGroup((m) => ({ ...m, [c.id]: '' }));
                      }}
                    >
                      ＋
                    </button>
                  </div>
                  <div className="roster-cat-actions">
                    <button
                      className="roster-connect-btn"
                      disabled={c.groups.length === 0}
                      onClick={() => onOpenConnect(c.id)}
                    >
                      📲 מסך התחברות
                    </button>
                    <button
                      className="roster-reset-btn"
                      onClick={() => onChange(resetCategoryMemberships(roster, c.id))}
                    >
                      ♻ איפוס מחוברים
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
