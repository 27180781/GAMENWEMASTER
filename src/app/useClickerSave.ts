/**
 * שמירת מספרי השלטים בבונה (clickerSave.ts) כל עוד משחק טעון — במסך ההגדרות
 * וגם במשחק עצמו, כדי ששיוך שלא נשלח (אין רשת, התוכנה נסגרה) יישלח גם לפני
 * שמתחילים לשחק. מחזיר את המצב לשורה במרשם, ופונקציה שמודיעה שהמרשם השתנה.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameFile } from '../engine/index.ts';
import { DEFAULT_BACKUP_CONFIG, type BackupConfig } from './backup.ts';
import {
  ClickerSaver,
  loadSettled,
  postClickerNumbers,
  saveSettled,
  type ClickerSaveView,
} from './clickerSave.ts';
import { loadRoster } from './roster.ts';

function sameView(a: ClickerSaveView | null, b: ClickerSaveView | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.saved === b.saved &&
    a.waiting === b.waiting &&
    a.rejected === b.rejected &&
    a.noLicense === b.noLicense &&
    a.sending === b.sending &&
    a.failing === b.failing
  );
}

export function useClickerSave(
  game: GameFile | null,
  baseUrlOverride: string | null,
): { view: ClickerSaveView | null; nudge: () => void } {
  const gameId = game?.id ?? '';
  const pending = game?.pendingUsers;
  // המנגנון נבנה מחדש רק כשרשימת הממתינים באמת השתנתה, לא בכל רענון של הקובץ.
  const pendingKey = useMemo(() => (pending ?? []).map((u) => u.id).join(','), [pending]);
  const pendingRef = useRef(pending ?? []);
  pendingRef.current = pending ?? [];
  const [view, setView] = useState<ClickerSaveView | null>(null);
  const saverRef = useRef<ClickerSaver | null>(null);

  useEffect(() => {
    if (gameId === '' || pendingRef.current.length === 0) {
      setView(null);
      return undefined;
    }
    const cfg: BackupConfig =
      baseUrlOverride !== null
        ? { baseUrl: baseUrlOverride, anonKey: DEFAULT_BACKUP_CONFIG.anonKey }
        : DEFAULT_BACKUP_CONFIG;
    const saver = new ClickerSaver({
      pending: pendingRef.current,
      readRoster: () => loadRoster(gameId),
      readSettled: () => loadSettled(gameId),
      writeSettled: (settled) => saveSettled(gameId, settled),
      send: (assignments) => postClickerNumbers(cfg, gameId, assignments),
    });
    saverRef.current = saver;
    const refresh = () => {
      const next = saver.view();
      setView((prev) => (sameView(prev, next) ? prev : next));
    };
    const off = saver.subscribe(refresh);
    refresh();
    saver.nudge(2000);
    const online = () => saver.retryNow();
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      off();
      saver.stop();
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, [gameId, pendingKey, baseUrlOverride]);

  const nudge = useCallback(() => saverRef.current?.nudge(), []);
  return { view, nudge };
}
