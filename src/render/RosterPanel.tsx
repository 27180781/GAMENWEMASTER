/**
 * לשונית "שמות וקבוצות" — ניהול מרשם השחקנים תוך כדי משחק.
 *
 *   • שמות   — טבלה של מספר (קליקר/טלפון) → שם, עם הוספה/עריכה/מחיקה, ולכל
 *              שחקן בורר קבוצה בכל קטגוריה.
 *   • קבוצות — הגדרת קטגוריות קבוצה (עיר מגורים, משקפיים…) והקבוצות שבכל אחת.
 *
 * עריכת שדות טקסט מתבצעת ב-onBlur (uncontrolled) כדי לא לבנות מחדש את המבנה
 * בכל הקשה; שיוך קבוצה מתעדכן מיד. כל שינוי עולה כלפי מעלה דרך onChange.
 */

import { useState } from 'react';
import {
  addCategory,
  addGroup,
  assignGroup,
  changePlayerId,
  groupOf,
  removeCategory,
  removeGroup,
  removePlayer,
  renameCategory,
  renameGroup,
  upsertPlayer,
  type RosterData,
} from '../app/roster.ts';

interface RosterPanelProps {
  roster: RosterData;
  onChange: (next: RosterData) => void;
  onClose: () => void;
}

export function RosterPanel({ roster, onChange, onClose }: RosterPanelProps) {
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
            <button
              className={tab === 'players' ? 'active' : ''}
              onClick={() => setTab('players')}
            >
              שמות ({roster.players.length})
            </button>
            <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>
              קבוצות ({roster.categories.length})
            </button>
          </div>
          <button className="roster-close" onClick={onClose}>
            סגור (ESC)
          </button>
        </header>

        {tab === 'players' && (
          <div className="roster-scroll">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>מספר</th>
                  <th>שם</th>
                  {roster.categories.map((c) => (
                    <th key={c.id}>{c.name || 'קטגוריה'}</th>
                  ))}
                  <th aria-label="מחיקה" />
                </tr>
              </thead>
              <tbody>
                {roster.players.map((player) => (
                  <tr key={player.id}>
                    <td>
                      <input
                        className="roster-num"
                        defaultValue={player.id}
                        onBlur={(e) => onChange(changePlayerId(roster, player.id, e.target.value))}
                      />
                    </td>
                    <td>
                      <input
                        defaultValue={player.name}
                        placeholder="שם השחקן"
                        onBlur={(e) => onChange(upsertPlayer(roster, player.id, e.target.value))}
                      />
                    </td>
                    {roster.categories.map((c) => (
                      <td key={c.id}>
                        <select
                          value={groupOf(roster, player.id, c.id)}
                          onChange={(e) => onChange(assignGroup(roster, player.id, c.id, e.target.value))}
                        >
                          <option value="">—</option>
                          {c.groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name || 'קבוצה'}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td>
                      <button
                        className="roster-del"
                        title="מחיקת שחקן"
                        onClick={() => onChange(removePlayer(roster, player.id))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {roster.players.length === 0 && (
                  <tr>
                    <td colSpan={3 + roster.categories.length} className="roster-empty">
                      אין שחקנים עדיין — הוסיפו מספר ושם למטה
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="roster-add">
              <input
                className="roster-num"
                placeholder="מספר"
                value={newNum}
                onChange={(e) => setNewNum(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
              />
              <input
                placeholder="שם"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
              />
              <button onClick={addPlayer}>+ הוספה</button>
            </div>
          </div>
        )}

        {tab === 'groups' && (
          <div className="roster-scroll">
            <div className="roster-add">
              <input
                placeholder="שם קטגוריה חדשה (עיר, משקפיים…)"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCat()}
              />
              <button onClick={addCat}>+ קטגוריה</button>
            </div>

            {roster.categories.length === 0 && (
              <p className="roster-empty">אין קטגוריות — הוסיפו קטגוריה, ובתוכה קבוצות</p>
            )}

            {roster.categories.map((c) => (
              <section key={c.id} className="roster-category">
                <header className="roster-category-head">
                  <input
                    className="roster-cat-name"
                    defaultValue={c.name}
                    placeholder="שם הקטגוריה"
                    onBlur={(e) => onChange(renameCategory(roster, c.id, e.target.value))}
                  />
                  <button
                    className="roster-del"
                    title="מחיקת קטגוריה"
                    onClick={() => onChange(removeCategory(roster, c.id))}
                  >
                    ✕
                  </button>
                </header>
                <ul className="roster-groups">
                  {c.groups.map((g) => (
                    <li key={g.id}>
                      <input
                        defaultValue={g.name}
                        placeholder="שם הקבוצה"
                        onBlur={(e) => onChange(renameGroup(roster, c.id, g.id, e.target.value))}
                      />
                      <button
                        className="roster-del"
                        title="מחיקת קבוצה"
                        onClick={() => onChange(removeGroup(roster, c.id, g.id))}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="roster-add roster-add--group">
                  <input
                    placeholder="קבוצה חדשה"
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
                    onClick={() => {
                      const name = (newGroup[c.id] ?? '').trim();
                      if (name === '') return;
                      onChange(addGroup(roster, c.id, name));
                      setNewGroup((m) => ({ ...m, [c.id]: '' }));
                    }}
                  >
                    + קבוצה
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
