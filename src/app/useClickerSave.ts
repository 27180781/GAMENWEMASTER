/**
 * שמירת מספרי השלטים בבונה (clickerSave.ts) כל עוד משחק טעון — במסך ההגדרות
 * וגם במשחק עצמו, כדי ששיוך שלא נשלח (אין רשת, התוכנה נסגרה) יישלח גם לפני
 * שמתחילים לשחק. מחזיר את המצב לשורה במרשם, פונקציה שמודיעה שהמרשם השתנה,
 * ופונקציה ל«שיוך מחדש» שמוחקת בבונה את השיוכים הישנים (clickerRelease.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameFile } from '../engine/index.ts';
import { DEFAULT_BACKUP_CONFIG, type BackupConfig } from './backup.ts';
import { addReleases, applyReleases, loadReleases, postReleases, saveReleases } from './clickerRelease.ts';
import {
  ClickerSaver,
  loadSettled,
  postClickerNumbers,
  saveSettled,
  type ClickerSaveView,
} from './clickerSave.ts';
import { loadRoster, type ReleasedClicker } from './roster.ts';

function sameView(a: ClickerSaveView | null, b: ClickerSaveView | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.saved === b.saved &&
    a.waiting === b.waiting &&
    a.rejected === b.rejected &&
    a.noLicense === b.noLicense &&
    a.sending === b.sending &&
    a.failing === b.failing &&
    a.releases.releasing === b.releases.releasing &&
    a.releases.kept === b.releases.kept &&
    a.releases.noLicense === b.releases.noLicense
  );
}

export function useClickerSave(
  game: GameFile | null,
  baseUrlOverride: string | null,
): { view: ClickerSaveView | null; nudge: () => void; release: (entries: ReleasedClicker[]) => void } {
  const gameId = game?.id ?? '';
  // הקובץ האחרון נקרא בכל שליחה, כך שרענון שלו לא בונה את המנגנון מחדש.
  const gameRef = useRef(game);
  gameRef.current = game;
  const [view, setView] = useState<ClickerSaveView | null>(null);
  const saverRef = useRef<ClickerSaver | null>(null);

  useEffect(() => {
    if (gameId === '') {
      setView(null);
      return undefined;
    }
    const cfg: BackupConfig =
      baseUrlOverride !== null
        ? { baseUrl: baseUrlOverride, anonKey: DEFAULT_BACKUP_CONFIG.anonKey }
        : DEFAULT_BACKUP_CONFIG;
    const saver = new ClickerSaver({
      readPending: () => {
        const current = gameRef.current;
        if (current === null || current.id !== gameId) return [];
        return applyReleases(current, loadReleases(gameId)).pendingUsers;
      },
      readRoster: () => loadRoster(gameId),
      readSettled: () => loadSettled(gameId),
      writeSettled: (settled) => saveSettled(gameId, settled),
      send: (assignments) => postClickerNumbers(cfg, gameId, assignments),
      readReleases: () => loadReleases(gameId),
      writeReleases: (map) => saveReleases(gameId, map),
      sendReleases: (releases) => postReleases(cfg, gameId, releases),
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
  }, [gameId, baseUrlOverride]);

  const nudge = useCallback(() => saverRef.current?.nudge(), []);

  /**
   * «שיוך מחדש»: השיוכים הישנים של משתתפים מהבונה נרשמים למחיקה שם, והתשובות
   * הקודמות עליהם נשכחות (השיוך החדש יישלח, גם כשזה אותו שלט). נשלח מיד.
   */
  const release = useCallback(
    (entries: ReleasedClicker[]) => {
      if (gameId === '' || entries.length === 0) return;
      saveReleases(gameId, addReleases(loadReleases(gameId), entries));
      const settled = loadSettled(gameId);
      const forget = entries.filter((e) => e.participantId in settled);
      if (forget.length > 0) {
        const next = { ...settled };
        for (const e of forget) delete next[e.participantId];
        saveSettled(gameId, next);
      }
      saverRef.current?.retryNow();
    },
    [gameId],
  );

  return { view, nudge, release };
}
