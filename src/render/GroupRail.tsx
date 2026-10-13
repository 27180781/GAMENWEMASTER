/**
 * פס הקבוצות בצד מסך השאלה — התצוגה של src/app/groupRail.ts (שם הכללים: מה
 * מוצג בכל שלב, ממי נספרים האחוזים, ולמה הניקוד קפוא עד החשיפה).
 *
 * שורה לכל קבוצה: המקום, השם והניקוד, ולצדם עיגול לשאלה הנוכחית — טבעת עם
 * אחוז (כמה מהקבוצה ענו בזמן ההצבעה, כמה צדקו בחשיפה), או עוגה קטנה בצבעי
 * התשובות (סקר, וכל שקופית בלי תשובה נכונה). לפני ההצבעה — הדירוג בלבד.
 *
 * כל שורה ממוקמת לפי המקום שלה (top לפי --i), והשורות נשארות ב-DOM בסדר קבוע
 * (לפי מזהה הקבוצה): כשהדירוג משתנה בחשיפה הן גולשות למקומן החדש. סידור מחדש
 * של הצמתים עצמם היה מבטל את המעבר בחלק מהשורות.
 */

import type { CSSProperties } from 'react';
import type { GroupRailData, GroupRailMode, GroupRailRow } from '../app/groupRail.ts';
import { FitText } from './FitText.tsx';

const TITLES: Record<GroupRailMode, string> = {
  standings: '🏆 דירוג הקבוצות',
  answered: '✋ כמה מכל קבוצה ענו',
  correct: '✅ כמה מכל קבוצה צדקו',
  split: '📊 מה כל קבוצה ענתה',
};

/** עוגה קטנה: כמה מהקבוצה בחרו בכל תשובה, בצבעי המטבעות. */
function railPieBackground(split: readonly number[], colors: readonly string[]): string | null {
  const total = split.reduce((sum, v) => sum + v, 0);
  if (total === 0) return null;
  let acc = 0;
  const stops = split.map((value, i) => {
    const from = acc;
    acc += (value / total) * 100;
    return `${colors[i % colors.length]} ${from}% ${acc}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function Figure({ row, mode, colors }: { row: GroupRailRow; mode: GroupRailMode; colors: readonly string[] }) {
  if (row.out) {
    return (
      <span className="gr-fig gr-fig--out" title="השאלה הזאת לקבוצה אחרת">
        🔒
      </span>
    );
  }
  if (mode === 'split') {
    const background = railPieBackground(row.split ?? [], colors);
    return (
      <span
        className={`gr-fig gr-pie${background === null ? ' gr-pie--empty' : ''}`}
        style={background === null ? undefined : { background }}
      />
    );
  }
  if (mode === 'answered' || mode === 'correct') {
    return (
      <span className={`gr-fig gr-ring gr-ring--${mode}`} style={{ '--gr-p': row.pct ?? 0 } as CSSProperties}>
        <span className={`gr-ring-num${row.pct === 100 ? ' gr-ring-num--full' : ''}`}>
          {row.pct === null ? '–' : `${row.pct}%`}
        </span>
      </span>
    );
  }
  return null;
}

export function GroupRail({ data, colors }: { data: GroupRailData; colors: readonly string[] }) {
  // סדר קבוע ב-DOM; המקום נקבע ב---i (ראו בראש הקובץ).
  const stable = [...data.rows].sort((a, b) => (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0));
  const dense = data.rows.length >= 8;
  return (
    <aside className={`gr-rail gr-rail--${data.mode}${dense ? ' gr-rail--dense' : ''}`} aria-label="דירוג הקבוצות">
      <div className="gr-head">
        <span className="gr-head-title">{TITLES[data.mode]}</span>
        {data.categoryCount > 1 && <span className="gr-head-cat">{data.categoryName}</span>}
      </div>
      {/* גובה השורה מתחלק לפחות לארבע — כך שתיים-שלוש קבוצות לא נמתחות לגובה כל הפס. */}
      <ol className="gr-rows" style={{ '--gr-n': Math.max(4, data.rows.length) } as CSSProperties}>
        {stable.map((row) => (
          <li
            key={row.groupId}
            className={`gr-row${row.rank === 1 ? ' gr-row--lead' : ''}${row.out ? ' gr-row--out' : ''}`}
            style={{ '--i': row.rank - 1 } as CSSProperties}
          >
            <span className={`gr-rank${row.rank <= 3 ? ` gr-rank--${row.rank}` : ''}`}>{row.rank}</span>
            <FitText className="gr-name" min={14}>
              {row.name}
            </FitText>
            <span className="gr-score">
              <span dir="ltr">{row.score.toLocaleString('en-US')}</span> נק׳
            </span>
            <Figure row={row} mode={data.mode} colors={colors} />
          </li>
        ))}
      </ol>
      {data.more > 0 && <div className="gr-more">ועוד {data.more} קבוצות</div>}
    </aside>
  );
}
