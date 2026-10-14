import { describe, expect, it } from 'vitest';
import {
  callLogRefusal,
  checkDial,
  isIndianMobile,
  istMinuteOfDay,
  nationalNumber,
  nextCallingWindowStart,
  numberSeries,
  withinCallingHours,
  type DialRequest,
} from './dial-policy';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';

/** An instant given in IST, the way people state calling hours. */
const ist = (isoLocal: string) => new Date(`${isoLocal}+05:30`);

const promotional: DialRequest = {
  at: ist('2026-09-28T11:00:00'),
  purpose: 'promotional',
  callerId: '+91 1401234567',
  to: '+91 98765 43210',
  hasRecordedConsent: false,
  onDnd: false,
};
const service: DialRequest = {
  ...promotional,
  purpose: 'service',
  callerId: '1600123456',
  hasRecordedConsent: true,
};

describe('TRAI calling hours, 09:00 to 21:00 IST', () => {
  it.each([
    ['2026-09-28T08:59:59', false],
    ['2026-09-28T09:00:00', true],
    ['2026-09-28T13:30:00', true],
    ['2026-09-28T20:59:59', true],
    ['2026-09-28T21:00:00', false],
    ['2026-09-28T23:45:00', false],
    ['2026-09-29T00:10:00', false],
  ])('%s IST is %s', (local, expected) => {
    expect(withinCallingHours(ist(local))).toBe(expected);
  });

  it('reads the hour in IST whatever the server clock zone', () => {
    // 03:30 UTC is 09:00 IST; 15:30 UTC is 21:00 IST.
    expect(istMinuteOfDay(new Date('2026-09-28T03:30:00Z'))).toBe(540);
    expect(withinCallingHours(new Date('2026-09-28T03:29:00Z'))).toBe(false);
    expect(withinCallingHours(new Date('2026-09-28T15:29:00Z'))).toBe(true);
    expect(withinCallingHours(new Date('2026-09-28T15:30:00Z'))).toBe(false);
  });

  it('names when calling may start again', () => {
    expect(nextCallingWindowStart(ist('2026-09-28T07:15:00')).toISOString()).toBe(
      ist('2026-09-28T09:00:00').toISOString(),
    );
    expect(nextCallingWindowStart(ist('2026-09-28T21:40:00')).toISOString()).toBe(
      ist('2026-09-29T09:00:00').toISOString(),
    );
    const open = ist('2026-09-28T10:00:00');
    expect(nextCallingWindowStart(open)).toBe(open);
  });
});

describe('numbers', () => {
  it('strips the country code and trunk prefix', () => {
    expect(nationalNumber('+91-98765-43210')).toBe('9876543210');
    expect(nationalNumber('09876543210')).toBe('9876543210');
    expect(nationalNumber('919876543210')).toBe('9876543210');
  });

  it('knows the DLT series of a caller id', () => {
    expect(numberSeries('1401234567')).toBe('140');
    expect(numberSeries('+911401234567')).toBe('140');
    expect(numberSeries('1600123456')).toBe('160');
    expect(numberSeries('08047112233')).toBe('other');
    expect(numberSeries('14012345')).toBe('other');
  });

  it('accepts only Indian mobile numbers as recipients', () => {
    expect(isIndianMobile('+91 98765 43210')).toBe(true);
    expect(isIndianMobile('6123456789')).toBe(true);
    expect(isIndianMobile('5123456789')).toBe(false);
    expect(isIndianMobile('02212345678')).toBe(false);
  });
});

describe('checkDial', () => {
  it('allows a promotional call from a 140 number in hours to a number off DND', () => {
    expect(checkDial(promotional)).toEqual({ allowed: true });
  });

  it('refuses a promotional call to a number on DND, or from a 160 number', () => {
    expect(checkDial({ ...promotional, onDnd: true })).toEqual({
      allowed: false,
      refusals: ['recipient_on_dnd'],
    });
    expect(checkDial({ ...promotional, callerId: '1600123456' })).toEqual({
      allowed: false,
      refusals: ['caller_id_not_promotional'],
    });
  });

  it('refuses a promotional call even with consent to a DND number', () => {
    expect(checkDial({ ...promotional, onDnd: true, hasRecordedConsent: true }).allowed).toBe(
      false,
    );
  });

  it('allows a service call from a 160 number with recorded consent, DND or not', () => {
    expect(checkDial(service)).toEqual({ allowed: true });
    expect(checkDial({ ...service, onDnd: true })).toEqual({ allowed: true });
  });

  it('refuses a service call without consent or from a 140 number', () => {
    expect(checkDial({ ...service, hasRecordedConsent: false })).toEqual({
      allowed: false,
      refusals: ['service_call_without_consent'],
    });
    expect(checkDial({ ...service, callerId: '1401234567' })).toEqual({
      allowed: false,
      refusals: ['caller_id_not_service'],
    });
  });

  it('refuses every call outside hours and lists every broken rule', () => {
    expect(
      checkDial({
        ...promotional,
        at: ist('2026-09-28T21:05:00'),
        to: '0221234567',
        callerId: '08047112233',
        onDnd: true,
      }),
    ).toEqual({
      allowed: false,
      refusals: [
        'outside_calling_hours',
        'recipient_not_a_mobile_number',
        'caller_id_not_promotional',
        'recipient_on_dnd',
      ],
    });
  });
});

describe('callLogRefusal (DOM-6)', () => {
  /** A time on 13-10-2026 in IST. */
  const at = (hhmm: string) => ist(`2026-10-13T${hhmm}:00`);

  it('accepts a call that started in hours and is logged in hours', () => {
    expect(callLogRefusal(at('10:00'), at('10:05'))).toBeUndefined();
  });

  it('accepts a call that started at 20:58 and is logged at 21:03, within the grace', () => {
    expect(WORKSHOP_DEFAULTS.calling.logGraceMinutes).toBe(15);
    expect(callLogRefusal(at('20:58'), at('21:03'))).toBeUndefined();
    expect(callLogRefusal(at('20:58'), at('21:15'))).toBeUndefined();
  });

  it('refuses a call that started in hours but is logged after the grace', () => {
    expect(callLogRefusal(at('20:58'), new Date(at('21:15').getTime() + 1000))).toBe(
      'call_logged_too_late',
    );
    expect(callLogRefusal(at('20:00'), at('22:00'))).toBe('call_logged_too_late');
  });

  it('refuses a call that started before 09:00, though it is logged in hours', () => {
    expect(callLogRefusal(at('08:50'), at('09:05'))).toBe('outside_calling_hours');
    expect(callLogRefusal(at('09:00'), at('09:05'))).toBeUndefined();
  });

  it('takes the grace the workshop sets', () => {
    expect(callLogRefusal(at('20:58'), at('21:25'), 30)).toBeUndefined();
    expect(callLogRefusal(at('20:58'), at('21:01'), 0)).toBe('call_logged_too_late');
  });

  it('refuses a call that started at 21:00 or later', () => {
    expect(callLogRefusal(at('21:00'), at('21:01'))).toBe('outside_calling_hours');
  });
});
