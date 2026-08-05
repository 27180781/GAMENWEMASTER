/**
 * מנוי לשני אותות שרשרת הקליקרים (חיבור תוכנת הקליטה · סטטוס הדונגל) והחזרת
 * הודעה ממוקדת לפי מה שבאמת שבור. ראו clickerLink.ts להסבר על שתי החוליות.
 *
 * שני האותות נשמרים בנפרד במכוון: הם מגיעים בזרמים נפרדים ובסדר לא מובטח,
 * ומחרוזת אחת שכל אירוע דורס הייתה מהבהבת בין המצבים.
 */

import { useEffect, useState } from 'react';
import {
  isDesktopClicker,
  onClickerEvent,
  onClickerServer,
  onReceiverClient,
} from '../app/clickerBridge.ts';
import { clickerLinkMessage, type ClickerServerState } from '../app/clickerLink.ts';

export function useClickerLink(): string | null {
  const [dongle, setDongle] = useState<string | null>(null);
  const [software, setSoftware] = useState<boolean | null>(null);
  const [server, setServer] = useState<ClickerServerState | null>(null);

  useEffect(() => {
    if (!isDesktopClicker()) return undefined;
    const offEvent = onClickerEvent((ev) => {
      if (ev.type === 'status') setDongle(ev.status);
    });
    const offClient = onReceiverClient((info) => setSoftware(info.connected));
    const offServer = onClickerServer(setServer);
    return () => {
      offEvent();
      offClient();
      offServer();
    };
  }, []);

  return clickerLinkMessage(software, dongle, server);
}
