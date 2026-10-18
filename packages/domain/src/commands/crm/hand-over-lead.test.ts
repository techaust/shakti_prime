import { describe, expect, it } from 'vitest';
import { handoverMachineAllows } from './hand-over-lead';

// The handover's machine check runs on the lead's real state (T2 review #9), so it can refuse.
describe('handoverMachineAllows', () => {
  const now = new Date('2026-10-18T06:00:00.000Z');

  it('lets the handover assign an open lead and a nurtured one, as the machine does', () => {
    expect(handoverMachineAllows('open', now)).toBe(true);
    expect(handoverMachineAllows('nurture', now)).toBe(true);
  });

  it('refuses a won or lost lead, which the machine has no assign from', () => {
    expect(handoverMachineAllows('won', now)).toBe(false);
    expect(handoverMachineAllows('lost', now)).toBe(false);
  });

  it('refuses a state the machine does not know', () => {
    expect(handoverMachineAllows('archived', now)).toBe(false);
  });
});
