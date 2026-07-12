/**
 * הערכת איכות החיבור למשחק אונליין — פונקציה טהורה (נבדקת ביחידה).
 *
 * הרף מכוון להיות נמוך ככל שבאמת צריך: המשחק מעביר אירועי הצבעה קטנים,
 * ולכן מזהירים רק כשהחיבור באמת בעייתי — אין אינטרנט, ניתוק ממושך מהשרת,
 * ניתוקים חוזרים, או רשת איטית/רוחב-פס נמוך מדי לפי Network Information API.
 */

export interface HealthInputs {
  /** ‏navigator.onLine — האם הדפדפן מדווח על חיבור לרשת. */
  online: boolean;
  /** סטטוס חיבור הסוקט, או null כשאין סוקט (דמו/אופליין). */
  socketStatus: 'connected' | 'reconnecting' | 'offline' | null;
  /** כמה זמן (ms) הסוקט אינו מחובר ברציפות (0 אם מחובר). */
  reconnectingMs: number;
  /** מספר הניתוקים ב-60 השניות האחרונות. */
  disconnectsInWindow: number;
  /** ‏navigator.connection.effectiveType — 'slow-2g' / '2g' / '3g' / '4g'. */
  effectiveType?: string | undefined;
  /** רוחב פס משוער ב-Mbps. */
  downlink?: number | undefined;
  /** השהיית הלוך-ושוב משוערת ב-ms. */
  rtt?: number | undefined;
}

export interface HealthWarning {
  code: 'offline' | 'socket-down' | 'unstable' | 'slow';
  severity: 'warn' | 'error';
  message: string;
}

/** משך ניתוק (ms) שמעליו מציגים אזהרה — מסנן בליפים קצרים שמתאוששים לבד. */
export const DISCONNECT_GRACE_MS = 5000;
/** מספר ניתוקים בחלון של 60ש׳ שמעליו החיבור נחשב לא יציב. */
export const FLAPPING_THRESHOLD = 3;

export function evaluateHealth(input: HealthInputs): HealthWarning[] {
  const warnings: HealthWarning[] = [];

  if (!input.online) {
    warnings.push({
      code: 'offline',
      severity: 'error',
      message: 'אין חיבור לאינטרנט — המשחק לא יקבל הצבעות עד שהחיבור יחזור.',
    });
  } else if (
    input.socketStatus !== null &&
    input.socketStatus !== 'connected' &&
    input.reconnectingMs >= DISCONNECT_GRACE_MS
  ) {
    warnings.push({
      code: 'socket-down',
      severity: 'error',
      message: 'מנותק משרת ההצבעות — מנסה להתחבר מחדש…',
    });
  }

  if (input.disconnectsInWindow >= FLAPPING_THRESHOLD) {
    warnings.push({
      code: 'unstable',
      severity: 'warn',
      message: 'החיבור לא יציב — ניתוקים חוזרים. כדאי לבדוק את הרשת.',
    });
  }

  const slow =
    input.effectiveType === 'slow-2g' ||
    input.effectiveType === '2g' ||
    (input.rtt !== undefined && input.rtt > 1500) ||
    (input.downlink !== undefined && input.downlink > 0 && input.downlink < 0.3);
  if (slow) {
    warnings.push({
      code: 'slow',
      severity: 'warn',
      message: 'החיבור איטי — ייתכנו עיכובים בהצבעות ובטעינת המדיה.',
    });
  }

  return warnings;
}
