import { describe, expect, it } from 'vitest';
import { fixtureDndRegistry, type DndAnswer, type DndRegistry } from '../ports/dnd';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { dndIsFresh, planDial, prepareDial, type DialFacts } from './dial-plan';

/** An instant given in IST. */
const ist = (isoLocal: string) => new Date(`${isoLocal}+05:30`);
const NOW = ist('2026-11-13T11:00:00');
const DAY = 86_400_000;

/** Synthetic DLT numbers and a made-up mobile. */
const facts: DialFacts = {
  entityId: 1,
  sourceChannel: 'import',
  hasOpenCallback: false,
  hasOrder: false,
  phoneE164: '+919812345678',
  phoneIsDnd: false,
  phoneDndCheckedAt: new Date(NOW.getTime() - DAY),
  hasServiceConsent: false,
  callConsentWithdrawn: false,
  promoNumber: '+911400000001',
  serviceNumber: '+911600000001',
};
const consentedEnquiry: DialFacts = { ...facts, sourceChannel: 'website', hasServiceConsent: true };

function deps(registry: DndRegistry = fixtureDndRegistry({ now: () => NOW })) {
  const recorded: DndAnswer[] = [];
  return {
    recorded,
    registry,
    record: (answer: DndAnswer) => {
      recorded.push(answer);
      return Promise.resolve();
    },
  };
}

describe('dndIsFresh', () => {
  it('holds a check for the workshop default of 7 days, and never one never made', () => {
    expect(WORKSHOP_DEFAULTS.calling.dndFreshDays).toBe(7);
    expect(dndIsFresh(new Date(NOW.getTime() - 7 * DAY + 1), NOW)).toBe(true);
    expect(dndIsFresh(new Date(NOW.getTime() - 7 * DAY), NOW)).toBe(false);
    expect(dndIsFresh(null, NOW)).toBe(false);
    expect(dndIsFresh(new Date(NOW.getTime() - 2 * DAY), NOW, 1)).toBe(false);
  });
});

describe('planDial (PRD TEL-04)', () => {
  const recorded = { kind: 'recorded', onDnd: false, checkedAt: NOW } as const;

  it('sends a consented service call out on the 160 number', () => {
    const plan = planDial(consentedEnquiry, NOW, recorded);
    expect(plan).toMatchObject({
      purpose: 'service',
      purposeReason: 'service_enquiry',
      callerId: '+911600000001',
      series: '160',
      decision: { allowed: true },
    });
  });

  it('sends every other call out on the 140 number, never the 160', () => {
    const plan = planDial({ ...facts, sourceChannel: 'website' }, NOW, recorded);
    expect(plan).toMatchObject({
      purpose: 'promotional',
      purposeReason: 'promotional_no_consent',
      callerId: '+911400000001',
      series: '140',
      decision: { allowed: true },
    });
  });

  it('refuses a promotional call to a DND number, and a call outside hours, with every reason', () => {
    expect(
      planDial(facts, ist('2026-11-13T21:30:00'), { ...recorded, onDnd: true }).decision,
    ).toEqual({ allowed: false, refusals: ['outside_calling_hours', 'recipient_on_dnd'] });
  });

  it('lets a consented service call reach a number on DND', () => {
    expect(planDial(consentedEnquiry, NOW, { ...recorded, onDnd: true }).decision).toEqual({
      allowed: true,
    });
  });

  it('refuses a customer who withdrew consent to calls on either series', () => {
    for (const f of [facts, consentedEnquiry]) {
      expect(planDial({ ...f, callConsentWithdrawn: true }, NOW, recorded).decision).toEqual({
        allowed: false,
        refusals: ['call_consent_withdrawn'],
      });
    }
  });

  it('refuses when the company has no number for the purpose', () => {
    expect(planDial({ ...facts, promoNumber: null }, NOW, recorded)).toMatchObject({
      callerId: null,
      series: null,
      decision: { allowed: false, refusals: ['company_number_missing'] },
    });
    expect(planDial({ ...consentedEnquiry, serviceNumber: null }, NOW, recorded).decision).toEqual({
      allowed: false,
      refusals: ['company_number_missing'],
    });
  });
});

describe('prepareDial', () => {
  it('uses a fresh check as recorded and asks the register nothing', async () => {
    const d = deps(fixtureDndRegistry());
    const plan = await prepareDial(facts, NOW, d);
    expect(plan.dnd).toEqual({
      kind: 'recorded',
      onDnd: false,
      checkedAt: facts.phoneDndCheckedAt,
    });
    expect(d.recorded).toEqual([]);
  });

  it('looks a stale check up again for a promotional call, records it and uses it', async () => {
    const registry = fixtureDndRegistry({ numbers: [facts.phoneE164], now: () => NOW });
    const d = deps(registry);
    const stale = { ...facts, phoneDndCheckedAt: new Date(NOW.getTime() - 8 * DAY) };
    const plan = await prepareDial(stale, NOW, d);
    expect(registry.asked).toEqual([facts.phoneE164]);
    expect(d.recorded).toEqual([{ onDnd: true, checkedAt: NOW }]);
    expect(plan.dnd).toEqual({ kind: 'refreshed', onDnd: true, checkedAt: NOW });
    expect(plan.decision).toEqual({ allowed: false, refusals: ['recipient_on_dnd'] });
  });

  it('looks up a number never checked', async () => {
    const d = deps();
    const plan = await prepareDial({ ...facts, phoneDndCheckedAt: null }, NOW, d);
    expect(plan.dnd.kind).toBe('refreshed');
    expect(plan.decision).toEqual({ allowed: true });
  });

  it('refuses the promotional dial when the register does not answer (dnd_unknown)', async () => {
    const d = deps(fixtureDndRegistry({ unreachable: true }));
    const stale = { ...facts, phoneDndCheckedAt: new Date(NOW.getTime() - 30 * DAY) };
    const plan = await prepareDial(stale, NOW, d);
    expect(plan.dnd).toEqual({ kind: 'unknown', checkedAt: stale.phoneDndCheckedAt });
    expect(plan.decision).toEqual({ allowed: false, refusals: ['dnd_unknown'] });
    expect(d.recorded).toEqual([]);
  });

  it('treats a register slower than the time limit as not answering', async () => {
    const slow: DndRegistry = { check: () => new Promise(() => undefined) };
    const plan = await prepareDial({ ...facts, phoneDndCheckedAt: null }, NOW, {
      ...deps(slow),
      timeoutMs: 10,
    });
    expect(plan.decision).toEqual({ allowed: false, refusals: ['dnd_unknown'] });
  });

  it('never asks the register for a consented service call, stale or not', async () => {
    const registry = fixtureDndRegistry({ unreachable: true });
    const plan = await prepareDial(
      { ...consentedEnquiry, phoneDndCheckedAt: null },
      NOW,
      deps(registry),
    );
    expect(registry.asked).toEqual([]);
    expect(plan.decision).toEqual({ allowed: true });
  });

  it('still uses an answer the platform failed to record', async () => {
    const plan = await prepareDial({ ...facts, phoneDndCheckedAt: null }, NOW, {
      registry: fixtureDndRegistry({ now: () => NOW }),
      record: () => Promise.reject(new Error('down')),
    });
    expect(plan.dnd).toEqual({ kind: 'refreshed', onDnd: false, checkedAt: NOW });
  });
});
