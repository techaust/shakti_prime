import { describe, expect, it } from 'vitest';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import {
  afterUnanswered,
  callingStartOnDay,
  istDayStart,
  nurtureCallTimes,
  unansweredAttempts,
} from './call-schedule';
import { withinCallingHours } from './dial-policy';

/** An instant given as IST wall-clock time. */
const ist = (local: string): Date => new Date(`${local}+05:30`);

describe('istDayStart', () => {
  it('is midnight IST of the day, also late in the evening and just after midnight', () => {
    expect(istDayStart(ist('2026-10-05T14:20:00'))).toEqual(ist('2026-10-05T00:00:00'));
    expect(istDayStart(ist('2026-10-05T23:59:59'))).toEqual(ist('2026-10-05T00:00:00'));
    expect(istDayStart(ist('2026-10-06T00:00:00'))).toEqual(ist('2026-10-06T00:00:00'));
    // 02:00 UTC is 07:30 IST: still the IST day, not the UTC one.
    expect(istDayStart(new Date('2026-10-05T20:00:00Z'))).toEqual(ist('2026-10-06T00:00:00'));
  });
});

describe('callingStartOnDay', () => {
  it('is 09:00 IST of the day so many days on', () => {
    expect(callingStartOnDay(ist('2026-10-05T18:45:00'), 0)).toEqual(ist('2026-10-05T09:00:00'));
    expect(callingStartOnDay(ist('2026-10-05T18:45:00'), 1)).toEqual(ist('2026-10-06T09:00:00'));
    expect(callingStartOnDay(ist('2026-10-31T10:00:00'), 1)).toEqual(ist('2026-11-01T09:00:00'));
  });
});

describe('afterUnanswered with the owner’s default (three attempts: day 1, 2 and 3)', () => {
  it('uses three attempts in all', () => {
    expect(WORKSHOP_DEFAULTS.calling.attemptDays).toEqual([0, 1, 2]);
  });

  it('after the first attempt, the second is due at 09:00 the next day', () => {
    const first = ist('2026-10-05T11:10:00');
    expect(afterUnanswered(1, first, first)).toEqual({
      kind: 'retry',
      dueAt: ist('2026-10-06T09:00:00'),
    });
  });

  it('after the second attempt, the third is due at 09:00 on day 3', () => {
    const first = ist('2026-10-05T11:10:00');
    expect(afterUnanswered(2, first, ist('2026-10-06T09:40:00'))).toEqual({
      kind: 'retry',
      dueAt: ist('2026-10-07T09:00:00'),
    });
  });

  it('a second attempt made early, on day 1, still leaves the third for day 3', () => {
    const first = ist('2026-10-05T11:10:00');
    expect(afterUnanswered(2, first, ist('2026-10-05T16:00:00'))).toEqual({
      kind: 'retry',
      dueAt: ist('2026-10-07T09:00:00'),
    });
  });

  it('an attempt made late moves the next to the next day, never the same day', () => {
    const first = ist('2026-10-05T11:10:00');
    expect(afterUnanswered(2, first, ist('2026-10-08T12:00:00'))).toEqual({
      kind: 'retry',
      dueAt: ist('2026-10-09T09:00:00'),
    });
  });

  it('after the third attempt the lead moves to nurture', () => {
    const first = ist('2026-10-05T11:10:00');
    expect(afterUnanswered(3, first, ist('2026-10-07T10:00:00'))).toEqual({ kind: 'nurture' });
    expect(afterUnanswered(4, first, ist('2026-10-08T10:00:00'))).toEqual({ kind: 'nurture' });
  });

  it('every retry falls inside calling hours', () => {
    const first = ist('2026-10-05T20:59:00');
    for (const attempt of [1, 2]) {
      for (const hour of ['09:00', '13:30', '20:59']) {
        const step = afterUnanswered(attempt, first, ist(`2026-10-06T${hour}:00`));
        if (step.kind !== 'retry') throw new Error('expected a retry');
        expect(withinCallingHours(step.dueAt)).toBe(true);
      }
    }
  });

  it('follows another list of attempt days (five attempts, every other day)', () => {
    const days = [0, 2, 4, 6, 8];
    const first = ist('2026-10-05T10:00:00');
    expect(afterUnanswered(1, first, first, days)).toEqual({
      kind: 'retry',
      dueAt: ist('2026-10-07T09:00:00'),
    });
    expect(afterUnanswered(5, first, first, days)).toEqual({ kind: 'nurture' });
  });
});

describe('nurtureCallTimes with the owner’s default (day 7, 30 and 90)', () => {
  it('falls due at 09:00 IST on day 7, 30 and 90 after the lead enters nurture', () => {
    expect(nurtureCallTimes(ist('2026-10-05T19:30:00'))).toEqual([
      ist('2026-10-12T09:00:00'),
      ist('2026-11-04T09:00:00'),
      ist('2027-01-03T09:00:00'),
    ]);
  });

  it('counts from the IST day, also for a lead parked just after midnight UTC', () => {
    // 2026-10-05T18:40Z is 00:10 IST on 6 October.
    expect(nurtureCallTimes(new Date('2026-10-05T18:40:00Z'), [7])).toEqual([
      ist('2026-10-13T09:00:00'),
    ]);
  });

  it('answers the days in order', () => {
    expect(nurtureCallTimes(ist('2026-10-05T10:00:00'), [30, 7])).toEqual([
      ist('2026-10-12T09:00:00'),
      ist('2026-11-04T09:00:00'),
    ]);
  });
});

describe('unansweredAttempts', () => {
  const changed = ist('2026-10-05T10:00:00');
  const call = (nextAction: string, attemptNo: number, startedAt: string) => ({
    nextAction,
    attemptNo,
    startedAt: ist(startedAt),
  });

  it('is none before the first call, and after an answered one', () => {
    expect(unansweredAttempts(undefined, changed)).toBe(0);
    expect(unansweredAttempts(call('callback', 2, '2026-10-05T11:00:00'), changed)).toBe(0);
  });

  it('is the last unanswered attempt made since the lead last changed state', () => {
    expect(unansweredAttempts(call('retry', 2, '2026-10-05T11:00:00'), changed)).toBe(2);
  });

  it('starts again once the lead enters or leaves nurture, also at the same moment', () => {
    expect(unansweredAttempts(call('retry', 3, '2026-10-04T11:00:00'), changed)).toBe(0);
    // The third try parks the lead in the same transaction: the call is not after the change.
    expect(unansweredAttempts(call('retry', 3, '2026-10-05T10:00:00'), changed)).toBe(0);
  });
});
