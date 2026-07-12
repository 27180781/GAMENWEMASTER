/**
 * בדיקות ל-evaluateHealth — הרף הנמוך של אזהרות איכות החיבור.
 */

import { describe, expect, it } from 'vitest';
import { evaluateHealth, type HealthInputs } from '../src/app/connectionHealth.ts';

const base: HealthInputs = {
  online: true,
  socketStatus: 'connected',
  reconnectingMs: 0,
  disconnectsInWindow: 0,
};

const codes = (i: HealthInputs) => evaluateHealth(i).map((w) => w.code);

describe('evaluateHealth', () => {
  it('חיבור תקין → אין אזהרות', () => {
    expect(evaluateHealth(base)).toEqual([]);
    expect(evaluateHealth({ ...base, effectiveType: '4g', downlink: 10, rtt: 40 })).toEqual([]);
  });

  it('אין אינטרנט → אזהרת offline (error)', () => {
    const w = evaluateHealth({ ...base, online: false });
    expect(w[0]!.code).toBe('offline');
    expect(w[0]!.severity).toBe('error');
  });

  it('ניתוק קצר (מתחת לרף) לא מזהיר; ניתוק ממושך כן', () => {
    expect(codes({ ...base, socketStatus: 'reconnecting', reconnectingMs: 3000 })).not.toContain(
      'socket-down',
    );
    expect(codes({ ...base, socketStatus: 'reconnecting', reconnectingMs: 6000 })).toContain(
      'socket-down',
    );
  });

  it('ניתוקים חוזרים → אזהרת unstable', () => {
    expect(codes({ ...base, disconnectsInWindow: 2 })).not.toContain('unstable');
    expect(codes({ ...base, disconnectsInWindow: 3 })).toContain('unstable');
  });

  it('רשת איטית / רוחב פס נמוך / rtt גבוה → אזהרת slow', () => {
    expect(codes({ ...base, effectiveType: '2g' })).toContain('slow');
    expect(codes({ ...base, effectiveType: 'slow-2g' })).toContain('slow');
    expect(codes({ ...base, rtt: 1600 })).toContain('slow');
    expect(codes({ ...base, downlink: 0.2 })).toContain('slow');
    // רף נמוך אך לא רגיש-יתר: 3g/4g תקינים
    expect(codes({ ...base, effectiveType: '3g', rtt: 300, downlink: 2 })).not.toContain('slow');
  });

  it('בלי סוקט (socketStatus=null) — אין אזהרת socket-down גם בניתוק ארוך', () => {
    expect(codes({ ...base, socketStatus: null, reconnectingMs: 9999 })).not.toContain(
      'socket-down',
    );
  });

  it('כמה בעיות במקביל → כמה אזהרות', () => {
    const w = codes({ ...base, online: false, disconnectsInWindow: 5, effectiveType: '2g' });
    expect(w).toContain('offline');
    expect(w).toContain('unstable');
    expect(w).toContain('slow');
  });
});
