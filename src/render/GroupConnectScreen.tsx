/**
 * מסך התחברות לקטגוריית קבוצות — מוצג במסך מלא. לכל קבוצה מספר (1..N לפי הסדר),
 * והשחקנים מקישים את המספר בקליקר/בטלפון כדי להצטרף (לחיצה אחרונה קובעת). מציג
 * בזמן אמת כמה הצטרפו לכל קבוצה, וכפתור לאיפוס המחוברים.
 */

interface GroupConnectScreenProps {
  categoryName: string;
  /** הקבוצות לפי סדר — מספר הקבוצה הוא המיקום + 1. */
  groups: { id: string; name: string }[];
  /** groupId → כמה הצטרפו. */
  counts: Record<string, number>;
  total: number;
  onReset: () => void;
  onClose: () => void;
}

/** צבעי מספרי הקבוצות — תואמים למטבעות התשובות (ירוק/אדום/לבן/זהב/כחול/כתום…). */
const NUM_COLORS = [
  { bg: '#2ec94f', fg: '#052e12' },
  { bg: '#e5342f', fg: '#fff' },
  { bg: '#f4f4f4', fg: '#111' },
  { bg: '#ffcf33', fg: '#3a2a00' },
  { bg: '#2f7bff', fg: '#fff' },
  { bg: '#ff8a1e', fg: '#3a1c00' },
  { bg: '#a05cff', fg: '#fff' },
  { bg: '#18c5c5', fg: '#02322f' },
  { bg: '#ff5fa2', fg: '#3a021c' },
];

export function GroupConnectScreen({
  categoryName,
  groups,
  counts,
  total,
  onReset,
  onClose,
}: GroupConnectScreenProps) {
  return (
    <div className="screen gconn-screen" dir="rtl">
      <div className="screen-content gconn-content">
        <button className="gconn-close" onClick={onClose} title="סגירה">
          ✕
        </button>
        <h1 className="gconn-title">התחברות לקבוצות · {categoryName}</h1>
        <p className="gconn-sub">הקישו את מספר הקבוצה שלכם כדי להצטרף · אפשר לתקן בכל רגע (הקשה אחרונה קובעת)</p>

        <div className="gconn-grid">
          {groups.map((g, i) => {
            const color = NUM_COLORS[i % NUM_COLORS.length]!;
            const n = counts[g.id] ?? 0;
            return (
              <div key={g.id} className="gconn-card">
                <span className="gconn-num" style={{ background: color.bg, color: color.fg }}>
                  {i + 1}
                </span>
                <span className="gconn-name">{g.name}</span>
                <span className="gconn-count">{n}</span>
              </div>
            );
          })}
          {groups.length === 0 && <p className="gconn-empty">אין קבוצות בקטגוריה זו</p>}
        </div>

        <div className="gconn-footer">
          <span className="gconn-total">סה״כ מחוברים: <b>{total}</b></span>
          <button className="gconn-reset" onClick={onReset}>
            ♻ איפוס המחוברים לקטגוריה
          </button>
        </div>
      </div>
    </div>
  );
}
