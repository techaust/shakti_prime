import type { ConvertingLeadDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { QUOTE_EXPIRY_NOTICE_MS } from '../notifications/push-plan';
import { nextBestActions, rulesMet } from './next-best-action';

const NOW = new Date('2030-03-05T10:00:00.000Z');
const at = (offsetMs: number): string => new Date(NOW.getTime() + offsetMs).toISOString();
const HOUR = 3_600_000;

let counter = 0;
/** A lead meeting no rule: sized, quoted for a long time yet, nothing due. */
function lead(over: Partial<ConvertingLeadDto> = {}): ConvertingLeadDto {
  counter += 1;
  return {
    opportunityId: `0199e2e0-0000-7000-8000-${String(counter).padStart(12, '0')}`,
    entityId: 1,
    accountId: '0199e2e0-0000-7000-8000-00000000aaaa',
    customerName: `Customer ${String(counter)}`,
    village: null,
    segment: 'farmer_pumps',
    pipelineName: 'Farmer Pumps',
    stageId: '0199e2e0-0000-7000-8000-00000000bbbb',
    stageKey: 'qualified',
    stageName: 'Qualified',
    stagePosition: 3,
    needsQuote: true,
    state: 'open',
    score: 50,
    stageSince: at(-48 * HOUR),
    nextCall: null,
    sizing: 'current',
    size: null,
    quote: null,
    heldOrder: null,
    ...over,
  };
}

const quote = (state: 'draft' | 'sent' | 'accepted' | 'expired', validIn: number) => ({
  id: '0199e2e0-0000-7000-8000-00000000cccc',
  quoteNo: 'SS/Q/2026/0001',
  state,
  validUntil: at(validIn),
  grandTotal: '1000.00',
});

describe('rulesMet', () => {
  it('meets none for a lead with nothing due', () => {
    expect(rulesMet(lead(), NOW)).toEqual([]);
  });

  it('calls a callback due at its time and overdue after it, never before', () => {
    expect(rulesMet(lead({ nextCall: { kind: 'callback', dueAt: at(1) } }), NOW)).toEqual([]);
    expect(rulesMet(lead({ nextCall: { kind: 'callback', dueAt: at(0) } }), NOW)).toEqual([
      'callback_due',
    ]);
    expect(rulesMet(lead({ nextCall: { kind: 'callback', dueAt: at(-30 * HOUR) } }), NOW)).toEqual([
      'callback_due',
    ]);
  });

  it('calls a quote about to expire when it lapses within the notice window', () => {
    const l = (state: 'draft' | 'sent' | 'accepted' | 'expired', validIn: number) =>
      lead({ quote: quote(state, validIn) });
    expect(rulesMet(l('sent', QUOTE_EXPIRY_NOTICE_MS), NOW)).toEqual(['quote_expiring']);
    expect(rulesMet(l('draft', 1), NOW)).toEqual(['quote_expiring']);
    expect(rulesMet(l('sent', QUOTE_EXPIRY_NOTICE_MS + 1), NOW)).toEqual([]);
  });

  it('leaves a quote that has lapsed or is settled alone', () => {
    const l = (state: 'draft' | 'sent' | 'accepted' | 'expired', validIn: number) =>
      lead({ quote: quote(state, validIn) });
    expect(rulesMet(l('sent', 0), NOW)).toEqual([]);
    expect(rulesMet(l('sent', -HOUR), NOW)).toEqual([]);
    expect(rulesMet(l('expired', HOUR), NOW)).toEqual([]);
    expect(rulesMet(l('accepted', HOUR), NOW)).toEqual([]);
  });

  it('calls an order held for credit', () => {
    const heldOrder = {
      id: '0199e2e0-0000-7000-8000-00000000dddd',
      soNo: 'SO/1',
      heldAt: at(-HOUR),
      grandTotal: '5.00',
    };
    expect(rulesMet(lead({ heldOrder }), NOW)).toEqual(['order_held']);
  });

  it('calls a missing or stale sizing only where the stage needs a quote and the line is sized', () => {
    expect(rulesMet(lead({ sizing: 'none' }), NOW)).toEqual(['sizing_missing']);
    expect(rulesMet(lead({ sizing: 'stale' }), NOW)).toEqual(['sizing_missing']);
    expect(rulesMet(lead({ sizing: 'none', needsQuote: false }), NOW)).toEqual([]);
    expect(rulesMet(lead({ sizing: 'none', segment: 'dealer_wholesale' }), NOW)).toEqual([]);
  });

  it('meets no rule for a lead that is not open', () => {
    const l = lead({
      state: 'nurture',
      sizing: 'none',
      nextCall: { kind: 'nurture', dueAt: at(-HOUR) },
    });
    expect(rulesMet(l, NOW)).toEqual([]);
  });

  it('meets several rules at once', () => {
    const l = lead({ sizing: 'none', nextCall: { kind: 'callback', dueAt: at(-HOUR) } });
    expect(rulesMet(l, NOW)).toEqual(['callback_due', 'sizing_missing']);
  });
});

describe('nextBestActions', () => {
  it('is empty for no leads and for leads with nothing to do', () => {
    expect(nextBestActions([], NOW)).toEqual([]);
    expect(nextBestActions([lead(), lead()], NOW)).toEqual([]);
  });

  it('puts the rules in order, whatever order the leads come in', () => {
    const sizing = lead({ customerName: 'A', sizing: 'none' });
    const held = lead({
      customerName: 'B',
      heldOrder: {
        id: '0199e2e0-0000-7000-8000-00000000dddd',
        soNo: 'SO/1',
        heldAt: at(-HOUR),
        grandTotal: '5.00',
      },
    });
    const expiring = lead({ customerName: 'C', quote: quote('sent', HOUR) });
    const call = lead({ customerName: 'D', nextCall: { kind: 'callback', dueAt: at(-HOUR) } });
    const rows = nextBestActions([sizing, held, expiring, call], NOW);
    expect(rows.map((r) => r.rule)).toEqual([
      'callback_due',
      'quote_expiring',
      'order_held',
      'sizing_missing',
    ]);
    expect(rows.map((r) => r.panel)).toEqual(['calls', 'quote', 'order', 'sizing']);
    expect(rows.map((r) => r.customerName)).toEqual(['D', 'C', 'B', 'A']);
  });

  it('puts the earliest time first within a rule', () => {
    const late = lead({ customerName: 'Late', nextCall: { kind: 'callback', dueAt: at(-HOUR) } });
    const later = lead({
      customerName: 'Later',
      nextCall: { kind: 'callback', dueAt: at(-2 * HOUR) },
    });
    const rows = nextBestActions([late, later], NOW);
    expect(rows.map((r) => r.customerName)).toEqual(['Later', 'Late']);
    expect(rows[0]?.at).toBe(at(-2 * HOUR));
  });

  it('puts the lead that has waited longest for a sizing first, with no time shown', () => {
    const newer = lead({ customerName: 'Newer', sizing: 'none', stageSince: at(-HOUR) });
    const older = lead({ customerName: 'Older', sizing: 'none', stageSince: at(-72 * HOUR) });
    const rows = nextBestActions([newer, older], NOW);
    expect(rows.map((r) => r.customerName)).toEqual(['Older', 'Newer']);
    expect(rows.every((r) => r.at === null)).toBe(true);
  });

  it('breaks a tie by customer name, then by lead, the same on every read', () => {
    const due = { kind: 'callback' as const, dueAt: at(-HOUR) };
    const b = lead({ customerName: 'Bhanwar', nextCall: due });
    const a = lead({ customerName: 'Anita', nextCall: due });
    const twin1 = lead({ customerName: 'Anita', nextCall: due });
    const forward = nextBestActions([b, a, twin1], NOW);
    const backward = nextBestActions([twin1, a, b], NOW);
    expect(forward).toEqual(backward);
    expect(forward.map((r) => r.customerName)).toEqual(['Anita', 'Anita', 'Bhanwar']);
    expect(forward[0]?.opportunityId).toBe(a.opportunityId);
  });

  it('gives a lead one row for each rule and each row opens the lead', () => {
    const l = lead({ sizing: 'none', nextCall: { kind: 'callback', dueAt: at(-HOUR) } });
    const rows = nextBestActions([l], NOW);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.opportunityId === l.opportunityId && r.entityId === 1)).toBe(true);
  });

  it('changes when the facts change: a sizing made, a callback set for later', () => {
    const before = lead({ sizing: 'none', nextCall: { kind: 'callback', dueAt: at(-HOUR) } });
    expect(nextBestActions([before], NOW)).toHaveLength(2);
    const after = {
      ...before,
      sizing: 'current' as const,
      nextCall: { kind: 'callback' as const, dueAt: at(24 * HOUR) },
    };
    expect(nextBestActions([after], NOW)).toEqual([]);
  });
});
