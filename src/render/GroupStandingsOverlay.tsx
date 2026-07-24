/**
 * מסך דירוג הקבוצות (פקודת מנחה 4, בשלב חשיפת התשובה). מציג איזו קבוצה מובילה
 * מכל הקבוצות (לפי ממוצע ניקוד — הוגן לקבוצות בגדלים שונים) ואת המובילים בתוך
 * כל קבוצה. אם המשחק מחולק לכמה *סוגי* קבוצות (קטגוריות) — מקש 5 עובר ביניהם.
 * המשחק "נעצר" כל עוד המסך פתוח (ראו overlayActive ב-GameHost); רווח/4 סוגרים.
 */

import type { RosterData } from '../app/roster.ts';
import {
  groupCategories,
  groupMembers,
  groupStandings,
  type AnswerTimes,
} from '../app/groupScore.ts';
import { FitText } from './FitText.tsx';

interface GroupStandingsOverlayProps {
  roster: RosterData;
  /** ניקוד השחקנים מהמנוע: voterId → ניקוד. */
  scores: Record<string, number>;
  /** זמני תגובה (שובר-שוויון) מהמנוע. */
  answerTimes: AnswerTimes;
  /** שם להצגה של משתתף (מרשם/מספר). */
  nameOf: (voterId: string) => string;
  /** איזו קטגוריה (סוג קבוצות) מוצגת — מקש 5 מגדיל; ממופה מודולו. */
  categoryIndex: number;
  onClose: () => void;
}

/** מדליות למקומות הראשונים; מעבר לכך — מספר המקום. */
const RANK_MEDAL = ['🥇', '🥈', '🥉'];
/** כמה מובילים להציג בתוך כל קבוצה. */
const TOP_LEADERS = 3;

export function GroupStandingsOverlay({
  roster,
  scores,
  answerTimes,
  nameOf,
  categoryIndex,
  onClose,
}: GroupStandingsOverlayProps) {
  const cats = groupCategories(roster);
  if (cats.length === 0) return null;
  // מודולו בטוח (גם לאינדקס שגדל ללא הגבלה מלחיצות 5 חוזרות).
  const idx = ((categoryIndex % cats.length) + cats.length) % cats.length;
  const cat = cats[idx]!;
  const standings = groupStandings(roster, cat.id, scores, answerTimes);
  const multi = cats.length > 1;

  return (
    <div className="gs-overlay" onClick={onClose}>
      <div className="gs-panel" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="gs-head">
          <h2 className="gs-title">דירוג הקבוצות</h2>
          <span className="gs-cat">
            {cat.name}
            {multi && <span className="gs-cat-idx"> ({idx + 1}/{cats.length})</span>}
          </span>
          <button className="gs-close" title="סגירה (4)" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="gs-grid">
          {standings.map((st, i) => {
            const leaders = groupMembers(roster, cat.id, st.groupId, scores, answerTimes).slice(
              0,
              TOP_LEADERS,
            );
            return (
              <section key={st.groupId} className={`gs-card${i === 0 ? ' gs-card--lead' : ''}`}>
                <header className="gs-card-head">
                  <span className="gs-rank">{RANK_MEDAL[i] ?? i + 1}</span>
                  <FitText className="gs-name">{st.name}</FitText>
                </header>
                <div className="gs-score">
                  <span className="gs-score-num">{Math.round(st.avgScore)}</span>
                  <span className="gs-score-lbl">ממוצע</span>
                </div>
                <div className="gs-meta">
                  {st.memberCount} משתתפים · {Math.round(st.totalScore)} נק׳ סה״כ
                </div>
                <ul className="gs-leaders">
                  {leaders.map((m, j) => (
                    <li key={m.id} className="gs-leader">
                      <span className="gs-leader-rank">{j + 1}</span>
                      <span className="gs-leader-name">{nameOf(m.id)}</span>
                      <span className="gs-leader-score">{Math.round(m.score)}</span>
                    </li>
                  ))}
                  {leaders.length === 0 && <li className="gs-leader gs-leader--empty">—</li>}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="gs-foot">
          מקש 4 / רווח לסגירה
          {multi && ' · מקש 5 למעבר בין סוגי הקבוצות'}
        </div>
      </div>
    </div>
  );
}
