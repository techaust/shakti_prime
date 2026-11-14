import type { ProviderCallDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { clock, elapsedSeconds } from './call-bar';

const call: ProviderCallDto = {
  id: '01931f6e-8a2b-7c3d-9e4f-5a6b7c8d9e0f',
  entityId: 1,
  opportunityId: '01931f6e-8a2b-7c3d-9e4f-5a6b7c8d9e10',
  callerId: null,
  direction: 'outbound',
  series: '160',
  purpose: 'service',
  status: 'ringing',
  startedAt: '2026-09-28T05:30:00.000Z',
  answeredAt: null,
  endedAt: null,
  durationS: null,
  hasRecording: false,
  callId: null,
};

describe('the call bar’s time', () => {
  it('reads minutes and seconds', () => {
    expect([clock(0), clock(9), clock(65), clock(3_600)]).toEqual(['0:00', '0:09', '1:05', '60:00']);
  });

  it('counts from the press while ringing, from the answer on the line, and the length once ended', () => {
    const now = Date.parse('2026-09-28T05:30:30.000Z');
    expect(elapsedSeconds(call, now)).toBe(30);
    expect(
      elapsedSeconds({ ...call, status: 'in_progress', answeredAt: '2026-09-28T05:30:10.000Z' }, now),
    ).toBe(20);
    expect(
      elapsedSeconds(
        { ...call, status: 'completed', durationS: 42, endedAt: '2026-09-28T05:31:00.000Z' },
        now,
      ),
    ).toBe(42);
  });
});
