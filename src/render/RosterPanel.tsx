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

import { useState } from 'react';
import {
  addCategory,
  addGroup,
  categoryMemberTotal,
  changePlayerId,
  groupCounts,
  removeCategory,
  removeGroup,
  removePlayer,
  renameCategory,
  renameGroup,
  resetCategoryMemberships,
  upsertPlayer,
  type RosterData,
} from '../app/roster.ts';

interface RosterPanelProps {
  roster: RosterData;
  onChange: (next: RosterData) => void;
  onClose: () => void;
  /** פתיחת מסך ההתחברות לקטגוריה (השחקנים מצטרפים לפי מספר הקבוצה). */
  onOpenConnect: (categoryId: string) => void;
}

export function RosterPanel({ roster, onChange, onClose, onOpenConnect }: RosterPanelProps) {
  const [tab, setTab] = useState<'players' | 'groups'>('players');
  const [newNum, setNewNum] = useState('');
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState('');
  const [newGroup, setNewGroup] = useState<Record<string, string>>({});

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
            <ul className="roster-names">
              {roster.players.map((player) => (
                <li key={player.id} className="roster-name-row">
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
                    placeholder="שם השחקן"
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
