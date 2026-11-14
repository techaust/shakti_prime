import { describe, expect, it } from 'vitest';
import { decideSend, type SendBudget, type SendFacts } from './send-checks';

const NOW = new Date('2026-11-14T06:00:00.000Z');
const OPEN = new Date(NOW.getTime() + 3_600_000);
const CLOSED = new Date(NOW.getTime() - 3_600_000);
const RULES = {
  marketingHoldShare: 0.8,
  messagesPerThreadHour: 20,
  linkHosts: [],
  companyNumbers: ['+919000000001'],
};

function facts(over: Partial<SendFacts> = {}): SendFacts {
  return {
    kind: 'text',
    status: 'queued',
    sendAttempted: false,
    templateName: null,
    templateParams: [],
    body: 'Your engineer visits tomorrow.',
    windowOpenUntil: OPEN,
    optedOut: false,
    confirmation: false,
    templateCategory: null,
    templateStatus: null,
    sentLastHour: 0,
    ...over,
  };
}
const template = (over: Partial<SendFacts> = {}) =>
  facts({
    kind: 'template',
    body: null,
    templateName: 'visit_update',
    templateParams: ['28-11-2026'],
    templateCategory: 'utility',
    templateStatus: 'approved',
    ...over,
  });
const budget = (over: Partial<SendBudget> = {}): SendBudget => ({
  used: 0,
  limit: 250,
  alreadyCounted: false,
  ...over,
});

describe('decideSend: the messaging worker’s checks, in order (docs/06-api.md §6)', () => {
  it('sends a session message in the window, which is not business-initiated', () => {
    expect(decideSend(facts(), budget(), NOW, RULES)).toEqual({
      kind: 'send',
      businessInitiated: false,
    });
  });

  it('skips a message no longer queued or already handed to Meta, before any other check', () => {
    expect(decideSend(facts({ status: 'sent', optedOut: true }), budget(), NOW, RULES)).toEqual({
      kind: 'skip',
    });
    expect(decideSend(facts({ sendAttempted: true }), budget(), NOW, RULES)).toEqual({
      kind: 'skip',
    });
  });

  it('refuses an opted-out number first, but sends the one confirmation of its STOP', () => {
    const all = facts({
      optedOut: true,
      windowOpenUntil: CLOSED,
      body: 'https://bit.ly/x',
      sentLastHour: 99,
    });
    expect(decideSend(all, budget({ used: 999 }), NOW, RULES)).toEqual({
      kind: 'refuse',
      refusal: 'opted_out',
    });
    expect(
      decideSend(template({ kind: 'system', optedOut: true, confirmation: true }), budget(), NOW, RULES),
    ).toMatchObject({ kind: 'send' });
    // A template that is not the confirmation stays refused.
    expect(decideSend(template({ optedOut: true }), budget(), NOW, RULES)).toEqual({
      kind: 'refuse',
      refusal: 'opted_out',
    });
  });

  it('then refuses free text outside the window, and an unapproved template', () => {
    expect(
      decideSend(facts({ windowOpenUntil: CLOSED, body: 'https://bit.ly/x' }), budget(), NOW, RULES),
    ).toEqual({ kind: 'refuse', refusal: 'window_closed' });
    expect(decideSend(facts({ windowOpenUntil: null }), budget(), NOW, RULES)).toEqual({
      kind: 'refuse',
      refusal: 'window_closed',
    });
    for (const status of ['pending', 'rejected', 'paused', null]) {
      expect(
        decideSend(template({ templateStatus: status, windowOpenUntil: CLOSED }), budget({ used: 999 }), NOW, RULES),
      ).toEqual({ kind: 'refuse', refusal: 'template_not_approved' });
    }
  });

  it('then counts a business-initiated template against the budget: marketing waits at 80%, others stop at the limit', () => {
    const outside = { windowOpenUntil: CLOSED };
    expect(decideSend(template(outside), budget({ used: 199 }), NOW, RULES)).toEqual({
      kind: 'send',
      businessInitiated: true,
    });
    expect(
      decideSend(template({ ...outside, templateCategory: 'marketing' }), budget({ used: 200 }), NOW, RULES),
    ).toEqual({ kind: 'wait', until: 'marketing_held' });
    expect(decideSend(template(outside), budget({ used: 250 }), NOW, RULES)).toEqual({
      kind: 'refuse',
      refusal: 'tier_budget_reached',
    });
    // A customer already counted opens no new chat; a template in the window counts nothing.
    expect(
      decideSend(template(outside), budget({ used: 250, alreadyCounted: true }), NOW, RULES),
    ).toMatchObject({ kind: 'send' });
    expect(decideSend(template(), budget({ used: 250 }), NOW, RULES)).toEqual({
      kind: 'send',
      businessInitiated: false,
    });
  });

  it('then runs the output filter over the text or the template values', () => {
    expect(decideSend(facts({ body: 'Call 98123 45678', sentLastHour: 99 }), budget(), NOW, RULES)).toEqual({
      kind: 'refuse',
      refusal: 'output_filter',
    });
    expect(
      decideSend(template({ templateParams: ['www.cheap-pumps.com'] }), budget(), NOW, RULES),
    ).toEqual({ kind: 'refuse', refusal: 'output_filter' });
  });

  it('last, holds a thread at 20 messages an hour, to be tried again', () => {
    expect(decideSend(facts({ sentLastHour: 19 }), budget(), NOW, RULES)).toMatchObject({
      kind: 'send',
    });
    expect(decideSend(facts({ sentLastHour: 20 }), budget(), NOW, RULES)).toEqual({
      kind: 'wait',
      until: 'rate_limited',
    });
  });
});
