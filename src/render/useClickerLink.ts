/**
 * מנוי לשני אותות שרשרת הקליקרים (חיבור תוכנת הקליטה · סטטוס הדונגל) והחזרת
 * הודעה ממוקדת לפי מה שבאמת שבור. ראו clickerLink.ts להסבר על שתי החוליות.
 *
 * שני האותות נשמרים בנפרד במכוון: הם מגיעים בזרמים נפרדים ובסדר לא מובטח,
 * ומחרוזת אחת שכל אירוע דורס הייתה מהבהבת בין המצבים.
 */

import { useEffect, useState } from 'react';
import { isDesktopClicker, onClickerEvent, onReceiverClient } from '../app/clickerBridge.ts';
import { clickerLinkMessage } from '../app/clickerLink.ts';

export function useClickerLink(): string | null {
  const [dongle, setDongle] = useState<string | null>(null);
  const [software, setSoftware] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isDesktopClicker()) return undefined;
    const offEvent = onClickerEvent((ev) => {
      if (ev.type === 'status') setDongle(ev.status);
    });
    const offClient = onReceiverClient((info) => setSoftware(info.connected));
    return () => {
      offEvent();
      offClient();
    };
  }, []);

  return clickerLinkMessage(software, dongle);
}
