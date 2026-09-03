/**
 * טופס שנבנה מהסכימה (ראו schemaForm.ts). כל שדה ב-schema.ts מקבל כאן עורך
 * מתאים לטיפוסו — ולכן שדה שיתווסף לסכימה בעתיד יופיע בעורך בלי לגעת בקוד
 * הזה. שדות בלי עורך ייעודי (מערכים/union) נערכים כ-JSON גולמי, כדי ששום דבר
 * בקובץ המשחק לא יישאר בלתי-נגיש.
 */

import { useState } from 'react';
import { getAt, setAt, type FieldNode } from '../app/schemaForm.ts';

interface SchemaFieldsProps<T> {
  nodes: FieldNode[];
  value: T;
  onChange: (next: T) => void;
  /** נתיב הבסיס בתוך value (ריק = השורש). */
  path?: string[];
}

/** האם המחרוזת נראית כצבע — אז מוסיפים בורר צבעים לצד הטקסט. */
function isColor(v: unknown): boolean {
  return typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v);
}

export function SchemaFields<T>({ nodes, value, onChange, path = [] }: SchemaFieldsProps<T>) {
  return (
    <div className="sf-group">
      {nodes.map((node) => (
        <SchemaField
          key={node.key}
          node={node}
          value={value}
          onChange={onChange}
          path={[...path, node.key]}
        />
      ))}
    </div>
  );
}

function SchemaField<T>({
  node,
  value,
  onChange,
  path,
}: {
  node: FieldNode;
  value: T;
  onChange: (next: T) => void;
  path: string[];
}) {
  const current = getAt(value, path);
  const set = (next: unknown) => onChange(setAt(value, path, next));

  if (node.kind === 'object') {
    /*
     * עטיפת מדיה — אובייקט שכל תוכנו `src` (לוגו, כל אחד משבעת הצלילים, מדיית
     * הפתיחה…). כאן המבנה הוא פרט של ה-JSON ולא משהו שמחבר המשחק צריך לפתוח:
     * אקורדיון מקונן שבתוכו שדה בודד בשם "קובץ / קישור" מסתיר את מה שבאמת
     * נערך. במקומו — שורה אחת עם התווית של האב.
     */
    const only = node.children.length === 1 ? node.children[0] : undefined;
    if (only?.key === 'src') {
      return (
        <SchemaField
          node={{ ...only, label: node.label }}
          value={value}
          onChange={onChange}
          path={[...path, only.key]}
        />
      );
    }
    return (
      <details className="sf-section" open={path.length <= 1}>
        <summary className="sf-summary">{node.label}</summary>
        <SchemaFields nodes={node.children} value={value} onChange={onChange} path={path} />
      </details>
    );
  }

  if (node.kind === 'boolean') {
    return (
      <label className="sf-row sf-row--check">
        <input type="checkbox" checked={current === true} onChange={(e) => set(e.target.checked)} />
        <span>{node.label}</span>
      </label>
    );
  }

  if (node.kind === 'number') {
    return (
      <label className="sf-row">
        <span className="sf-label">{node.label}</span>
        <input
          className="sf-input"
          type="number"
          dir="ltr"
          defaultValue={typeof current === 'number' ? current : ''}
          key={path.join('.')}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            // ריק ≠ 0: מה נכתב בריקון נקבע בסכימה (ראו FieldNode.empty).
            if (raw === '') set(node.empty);
            else set(Number(raw));
          }}
        />
      </label>
    );
  }

  if (node.kind === 'enum') {
    const text = String(current ?? '');
    // ערך שאינו ברשימה (קובץ שנשמר בגרסה אחרת) נשאר מוצג כמו שהוא, כדי שלא
    // ייראה כאילו נבחרה אפשרות אחרת — ולא ידרוס בשקט את מה שכתוב בקובץ.
    const known = node.options.some((o) => o.value === text);
    return (
      <label className="sf-row">
        <span className="sf-label">{node.label}</span>
        <select className="sf-input" value={text} onChange={(e) => set(e.target.value)}>
          {!known && <option value={text}>{text === '' ? '(לא נבחר)' : text}</option>}
          {node.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (node.kind === 'json') {
    return <JsonField label={node.label} value={current} onSet={set} pathKey={path.join('.')} />;
  }

  // מחרוזת
  const text = typeof current === 'string' ? current : '';
  return (
    <label className="sf-row">
      <span className="sf-label">{node.label}</span>
      <span className="sf-input-wrap">
        <input
          className="sf-input"
          type="text"
          defaultValue={text}
          key={path.join('.')}
          onBlur={(e) => set(e.target.value)}
        />
        {isColor(text) && (
          <input
            className="sf-color"
            type="color"
            value={text.slice(0, 7)}
            onChange={(e) => set(e.target.value)}
            title="בחירת צבע"
          />
        )}
      </span>
    </label>
  );
}

/**
 * שדה שאין לו עורך ייעודי — נערך כ-JSON. הערך מוחל רק אם הוא תקין, כדי
 * שהקלדה חלקית לא תשבור את קובץ המשחק.
 */
function JsonField({
  label,
  value,
  onSet,
  pathKey,
}: {
  label: string;
  value: unknown;
  onSet: (v: unknown) => void;
  pathKey: string;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="sf-row sf-row--json">
      <span className="sf-label">{label}</span>
      <textarea
        className="sf-input sf-json"
        dir="ltr"
        defaultValue={JSON.stringify(value ?? null)}
        key={pathKey}
        onBlur={(e) => {
          try {
            onSet(JSON.parse(e.target.value) as unknown);
            setError(null);
          } catch {
            setError('הערך אינו JSON תקין — השינוי לא הוחל');
          }
        }}
      />
      {error !== null && <span className="sf-error">{error}</span>}
    </label>
  );
}
