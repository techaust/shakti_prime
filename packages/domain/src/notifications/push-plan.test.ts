import { describe, expect, it } from 'vitest';
import { choiceFor, inQuietHours, istMinute, minuteOf, pushPlan } from './push-plan';

/** An instant at the given IST time on 06-10-2026 (IST is UTC+05:30). */
const ist = (hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 6, (h ?? 0) - 5, (m ?? 0) - 30));
};

describe('quiet hours (IST)', () => {
  it('reads the time of day in India whatever the server clock says', () => {
    expect(istMinute(ist('00:00'))).toBe(0);
    expect(istMinute(ist('09:15'))).toBe(555);
    expect(istMinute(ist('23:59'))).toBe(1439);
    expect(minuteOf('21:30')).toBe(1290);
    expect(() => minuteOf('24:00')).toThrow(RangeError);
  });

  it('holds from the start up to, not including, the end within one day', () => {
    expect(inQuietHours(ist('12:59'), '13:00', '14:00')).toBe(false);
    expect(inQuietHours(ist('13:00'), '13:00', '14:00')).toBe(true);
    expect(inQuietHours(ist('13:59'), '13:00', '14:00')).toBe(true);
    expect(inQuietHours(ist('14:00'), '13:00', '14:00')).toBe(false);
  });

  it('runs across midnight when the hours end earlier than they start', () => {
    expect(inQuietHours(ist('21:59'), '22:00', '07:00')).toBe(false);
    expect(inQuietHours(ist('22:00'), '22:00', '07:00')).toBe(true);
    expect(inQuietHours(ist('00:00'), '22:00', '07:00')).toBe(true);
    expect(inQuietHours(ist('06:59'), '22:00', '07:00')).toBe(true);
    expect(inQuietHours(ist('07:00'), '22:00', '07:00')).toBe(false);
  });

  it('has none when none are set', () => {
    expect(inQuietHours(ist('03:00'), null, null)).toBe(false);
    expect(inQuietHours(ist('03:00'), '03:00', '03:00')).toBe(false);
  });
});

describe('a person’s choice and the push plan', () => {
  const rows = [
    { userId: 'a', type: 'call_due', inApp: true, push: false, quietFrom: null, quietTo: null },
    { userId: 'a', type: null, inApp: true, push: true, quietFrom: '22:00', quietTo: '07:00' },
    { userId: 'b', type: 'lead_assigned', inApp: false, push: true, quietFrom: null, quietTo: null },
  ];

  it('turns everything on, with no quiet hours, for a person who set nothing', () => {
    expect(choiceFor(rows, 'c', 'call_due')).toEqual({
      inApp: true,
      push: true,
      quietFrom: null,
      quietTo: null,
    });
  });

  it('takes the kind’s own switches and the person’s quiet hours', () => {
    expect(choiceFor(rows, 'a', 'call_due')).toEqual({
      inApp: true,
      push: false,
      quietFrom: '22:00',
      quietTo: '07:00',
    });
    expect(choiceFor(rows, 'a', 'lead_assigned').push).toBe(true);
    expect(choiceFor(rows, 'b', 'lead_assigned').inApp).toBe(false);
  });

  it('sends, holds in quiet hours, or does nothing when off or with no browser', () => {
    const quiet = choiceFor(rows, 'a', 'lead_assigned');
    expect(pushPlan(quiet, 1, ist('10:00'))).toBe('send');
    expect(pushPlan(quiet, 2, ist('23:00'))).toBe('held');
    expect(pushPlan(quiet, 0, ist('10:00'))).toBe('none');
    expect(pushPlan(choiceFor(rows, 'a', 'call_due'), 1, ist('10:00'))).toBe('off');
  });
});
