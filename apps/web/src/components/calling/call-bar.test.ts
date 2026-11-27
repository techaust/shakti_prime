import type { ProviderCallDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { clock, elapsedSeconds, serverClockOffset, stillReading } from './call-bar';

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
    expect([clock(0), clock(9), clock(65), clock(3_600)]).toEqual([
      '0:00',
      '0:09',
      '1:05',
      '60:00',
    ]);
  });

  it('counts from the press while ringing, from the answer on the line, and the length once ended', () => {
    const now = Date.parse('2026-09-28T05:30:30.000Z');
    expect(elapsedSeconds(call, now)).toBe(30);
    expect(
      elapsedSeconds(
        { ...call, status: 'in_progress', answeredAt: '2026-09-28T05:30:10.000Z' },
        now,
      ),
    ).toBe(20);
    expect(
      elapsedSeconds(
        { ...call, status: 'completed', durationS: 42, endedAt: '2026-09-28T05:31:00.000Z' },
        now,
      ),
    ).toBe(42);
  });
});

describe('the call bar on the server’s clock, whatever the device’s clock says', () => {
  // The dial's answer: the server pressed Dial at 11:00:00 IST (05:30 UTC).
  const pressed = Date.parse(call.startedAt);
  const hour = 3_600_000;

  it('reads the offset from the dial’s answer, ahead or behind', () => {
    expect(serverClockOffset(call.startedAt, pressed + 200)).toBe(-200);
    // The device runs eleven hours behind (the journeys move the server's clock forward so).
    expect(serverClockOffset(call.startedAt, pressed - 11 * hour)).toBe(11 * hour);
    // The device runs five hours ahead.
    expect(serverClockOffset(call.startedAt, pressed + 5 * hour)).toBe(-5 * hour);
  });

  it('counts the call from the press on a device whose clock is hours out', () => {
    for (const skew of [-11 * hour, -5 * 60_000, 0, 5 * hour]) {
      const receivedAt = pressed + skew;
      const offset = serverClockOffset(call.startedAt, receivedAt);
      // Twelve seconds after the answer arrived, by the device's own clock.
      const serverNow = receivedAt + 12_000 + offset;
      expect(elapsedSeconds(call, serverNow)).toBe(12);
      expect(
        elapsedSeconds(
          { ...call, status: 'in_progress', answeredAt: '2026-09-28T05:30:02.000Z' },
          serverNow,
        ),
      ).toBe(10);
    }
  });

  it('keeps reading a running call for three hours from the press, then stops', () => {
    // A device five hours ahead: on its own clock the call looks older than three hours.
    const receivedAt = pressed + 5 * hour;
    const offset = serverClockOffset(call.startedAt, receivedAt);
    expect(stillReading(call, receivedAt + offset)).toBe(true);
    expect(stillReading(call, receivedAt + 2 * hour + offset)).toBe(true);
    expect(stillReading(call, receivedAt + 3 * hour + 1 + offset)).toBe(false);
  });
});
