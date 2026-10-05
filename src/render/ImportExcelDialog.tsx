/**
 * חלון «יבוא מאקסל» של העורך המקומי — כמו החלון בעורך המקוון: שומרים את
 * התבנית, ממלאים אותה, בוחרים את הקובץ מהמחשב, ורואים לפני היבוא אילו שאלות
 * נמצאו, מה דולג ומה תוקן אוטומטית. הקריאה והפירוק מקומיים לגמרי — בלי רשת.
 *
 * הכללים וההודעות ב-questionImport.ts (זהים לבונה); כאן רק התצוגה.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameFile } from '../engine/index.ts';
import {
  IMPORT_ACCEPT,
  IMPORT_TEXT,
  isSupportedImportName,
  parseQuestionRows,
  TEMPLATE_COL_WIDTHS,
  TEMPLATE_FILE_NAME,
  TEMPLATE_ROWS,
  TEMPLATE_SHEET_NAME,
  type ImportedQuestion,
  type QuestionImport,
} from '../app/questionImport.ts';
import { readSheet } from '../app/xlsxRead.ts';
import { SheetFileError } from '../app/xlsRead.ts';
import { buildXlsxBlob, downloadBlob } from '../app/xlsx.ts';
import { desktopSaveFileAs } from '../app/clickerBridge.ts';

interface ImportExcelDialogProps {
  game: GameFile;
  /** השקופית שנבחרה בעורך — אפשר להוסיף את השאלות מיד אחריה. */
  selected: number;
  /** `after` = מיקום השקופית שאחריה מוסיפים, או null לסוף המשחק. */
  onImport: (questions: ImportedQuestion[], after: number | null) => void;
  onClose: () => void;
}

const TYPE_LABEL: Record<ImportedQuestion['type'], string> = { trivia: 'טריוויה', survey: 'סקר' };

const TEMPLATE_SAVE_FAILED = 'שמירת התבנית נכשלה. אם קובץ בשם הזה פתוח באקסל, סגרו אותו ונסו שוב.';

/** מה קרה בלחיצה האחרונה על "הורד תבנית" (ביטול השמירה = בלי הודעה). */
type TemplateState = { kind: 'saved'; path: string } | { kind: 'error'; text: string };

export function ImportExcelDialog({ game, selected, onImport, onClose }: ImportExcelDialogProps) {
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<QuestionImport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [atEnd, setAtEnd] = useState(true);
  const [template, setTemplate] = useState<TemplateState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const questions = parsed?.questions ?? [];
  const error = fileError ?? parsed?.error ?? null;
  const warnings = parsed?.issues.filter((i) => i.level === 'warning').length ?? 0;
  // "אחרי הנבחרת" שונה מ"בסוף" רק כשהנבחרת אינה האחרונה.
  const canInsertAfter = selected < game.questions.length - 1;

  /** סגירה בלי יבוא — כמו בבונה, שואלים קודם אם כבר נטענו שאלות. */
  const requestClose = useCallback(() => {
    if (
      questions.length > 0 &&
      !window.confirm(`טענת ${questions.length} שאלות שלא יובאו. לסגור ולאבד את הקובץ?`)
    ) {
      return;
    }
    onClose();
  }, [questions.length, onClose]);

  // Esc סוגר, והמיקוד נכנס לחלון — אחרת המקלדת נשארת בעורך שמאחור.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const processFile = async (file: File) => {
    setFileName(file.name);
    setParsed(null);
    setFileError(null);
    try {
      if (!isSupportedImportName(file.name)) {
        setFileError(IMPORT_TEXT.unsupportedFile);
        return;
      }
      setReading(true);
      const rows = await readSheet(new Uint8Array(await file.arrayBuffer()));
      setParsed(parseQuestionRows(rows));
    } catch (e) {
      // הודעה שנוסחה למשתמש (מוגן בסיסמה, Excel 95, דף אינטרנט) — כמו שהיא.
      setFileError(e instanceof SheetFileError ? e.message : IMPORT_TEXT.fileReadingError);
    } finally {
      setReading(false);
      // כדי שבחירה חוזרת של אותו קובץ (אחרי תיקון באקסל) תיקרא שוב
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  };

  const saveTemplate = async () => {
    setTemplate(null);
    try {
      const blob = await buildXlsxBlob([
        { name: TEMPLATE_SHEET_NAME, rows: TEMPLATE_ROWS, cols: TEMPLATE_COL_WIDTHS },
      ]);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const saved = await desktopSaveFileAs(TEMPLATE_FILE_NAME, bytes);
      if (saved === null) {
        downloadBlob(blob, TEMPLATE_FILE_NAME); // לא ב-EXE — הורדה רגילה
      } else if (saved.ok) {
        setTemplate({ kind: 'saved', path: saved.path ?? TEMPLATE_FILE_NAME });
      } else if (saved.canceled !== true) {
        setTemplate({ kind: 'error', text: TEMPLATE_SAVE_FAILED });
      }
    } catch {
      setTemplate({ kind: 'error', text: 'יצירת התבנית נכשלה.' });
    }
  };

  return (
    <div
      className="sa-backdrop"
      onClick={requestClose}
      role="presentation"
      // קובץ שנזרק ליד אזור הגרירה לא אמור לפתוח אותו בחלון התוכנה במקום העורך
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file !== undefined) void processFile(file);
      }}
    >
      <div
        className="sa-modal xi-modal"
        role="dialog"
        aria-modal="true"
        aria-label="יבוא שאלות מאקסל"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sa-head">
          <h2 className="sa-title">📊 יבוא שאלות מאקסל</h2>
          <button
            ref={closeRef}
            type="button"
            className="sa-close"
            onClick={requestClose}
            title="סגירה"
          >
            ✕
          </button>
        </div>
        <p className="xi-sub">הורידו את התבנית, מלאו את השאלות, ובחרו את הקובץ מהמחשב</p>

        <div className="sa-body">
          <section className="xi-step">
            <div className="xi-step-head">
              <span className="xi-step-num">1</span>
              הורידו את תבנית האקסל
            </div>
            <button type="button" className="xi-template" onClick={() => void saveTemplate()}>
              ⬇ הורד תבנית Excel
            </button>
            {template?.kind === 'saved' && (
              <p className="xi-msg xi-msg--ok">
                {/* נתיב של Windows נקרא משמאל לימין גם בתוך משפט בעברית */}
                התבנית נשמרה: <bdi dir="ltr">{template.path}</bdi>
              </p>
            )}
            {template?.kind === 'error' && <p className="xi-msg xi-msg--error">{template.text}</p>}
          </section>

          <section className="xi-step">
            <div className="xi-step-head">
              <span className="xi-step-num">2</span>
              בחרו את הקובץ המלא
            </div>
            <div
              className={`xi-drop${dragging ? ' xi-drop--over' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragEnter={() => setDragging(true)}
              onDragOver={() => setDragging(true)}
              onDragLeave={(e) => {
                // מעבר מעל רכיב פנימי אינו יציאה מהאזור
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept={IMPORT_ACCEPT}
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file !== undefined) void processFile(file);
                }}
              />
              <span className="xi-drop-icon">📂</span>
              <p className="xi-drop-main">
                {reading ? 'קורא את הקובץ…' : 'לחצו לבחירת קובץ מהמחשב, או גררו אותו לכאן'}
              </p>
              {fileName !== null && !reading && <p className="xi-file">📄 {fileName}</p>}
              <p className="xi-drop-sub">Excel (.xlsx, .xls) או CSV</p>
            </div>
          </section>

          {error !== null && <p className="xi-msg xi-msg--error">{error}</p>}

          {parsed !== null && parsed.notices.length > 0 && (
            <div className="xi-notices">
              {parsed.notices.map((n, i) => (
                <p key={i} className={`xi-msg xi-msg--${n.level}`}>
                  {n.message}
                </p>
              ))}
            </div>
          )}

          {parsed !== null &&
            (questions.length > 0 || parsed.issues.length > 0 || parsed.skipped > 0) && (
              <div className="xi-chips">
                {questions.length > 0 && (
                  <span className="xi-chip xi-chip--ok">✓ {questions.length} שאלות תקינות</span>
                )}
                {parsed.skipped > 0 && (
                  <span className="xi-chip xi-chip--skip">{parsed.skipped} שורות דולגו</span>
                )}
                {warnings > 0 && <span className="xi-chip xi-chip--warn">{warnings} אזהרות</span>}
              </div>
            )}

          {parsed !== null && parsed.issues.length > 0 && (
            <div className="xi-step">
              <div className="xi-list-title">בעיות ותיקונים אוטומטיים:</div>
              <ul className="xi-list">
                {parsed.issues.map((issue, i) => (
                  <li key={i} className={`xi-issue xi-issue--${issue.level}`}>
                    <span className="xi-issue-row">שורה {issue.row}:</span>
                    {issue.message}
                    {issue.preview !== '' && (
                      <span className="xi-issue-preview">"{issue.preview}"</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {questions.length > 0 && (
            <div className="xi-step">
              <div className="xi-list-title xi-list-title--ok">
                ✓ תצוגה מקדימה ({questions.length})
              </div>
              <ol className="xi-list">
                {questions.map((q, i) => (
                  <li key={q.row} className="xi-q">
                    <span className="xi-q-num">{i + 1}.</span>
                    <span className="xi-q-text" title={q.question}>
                      {q.question}
                    </span>
                    <span className="xi-q-ans">{q.answers.length} תש'</span>
                    <span className={`xi-q-type xi-q-type--${q.type}`}>{TYPE_LABEL[q.type]}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {questions.length > 0 && canInsertAfter && (
            <fieldset className="xi-place">
              <legend>איפה להוסיף את השאלות?</legend>
              <label>
                <input
                  type="radio"
                  name="xi-place"
                  checked={atEnd}
                  onChange={() => setAtEnd(true)}
                />
                בסוף המשחק
              </label>
              <label>
                <input
                  type="radio"
                  name="xi-place"
                  checked={!atEnd}
                  onChange={() => setAtEnd(false)}
                />
                אחרי השקופית הנבחרת (שקופית {selected + 1})
              </label>
            </fieldset>
          )}
        </div>

        <div className="xi-actions">
          <button type="button" className="xi-cancel" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="sa-done xi-go"
            disabled={questions.length === 0}
            onClick={() => onImport(questions, atEnd || !canInsertAfter ? null : selected)}
          >
            {questions.length > 0 ? `ייבא ${questions.length} שאלות` : 'ייבא שאלות'}
          </button>
        </div>
      </div>
    </div>
  );
}
