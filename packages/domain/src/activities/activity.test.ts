import { newId } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_LABEL_MAX, activityRow, payloadProblem } from './activity';

const principal = { id: newId() };
const accountId = newId();

describe('payloadProblem', () => {
  it('takes ids, codes, counts, flags and short labels', () => {
    expect(
      payloadProblem({
        opportunityId: newId(),
        stageKey: 'qualified',
        count: 3,
        existingAccount: false,
        sourceCode: null,
        label: 'Summer drive',
      }),
    ).toBeUndefined();
  });

  it('takes a label of exactly the longest length and refuses one character more', () => {
    expect(payloadProblem({ label: 'a'.repeat(ACTIVITY_LABEL_MAX) })).toBeUndefined();
    expect(payloadProblem({ label: 'a'.repeat(ACTIVITY_LABEL_MAX + 1) })).toMatch(/label/);
  });

  it('refuses an email address or a phone number, but not an id full of digits', () => {
    expect(payloadProblem({ who: 'ram@example.com' })).toMatch(/email/);
    expect(payloadProblem({ who: '+919876543210' })).toMatch(/phone/);
    expect(payloadProblem({ who: 'call 987654' })).toBeUndefined();
    expect(payloadProblem({ id: '01990000-0000-7000-8000-000000000301' })).toBeUndefined();
  });

  it('refuses nested values, odd field names, endless numbers and too many fields', () => {
    expect(payloadProblem({ nested: { a: 1 } })).toMatch(/nested/);
    expect(payloadProblem({ 'bad key': 1 })).toMatch(/field name/);
    expect(payloadProblem({ n: Number.POSITIVE_INFINITY })).toMatch(/finite/);
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${String(i)}`, i]));
    expect(payloadProblem(many)).toMatch(/too many/);
    expect(payloadProblem(Object.fromEntries(Object.entries(many).slice(0, 16)))).toBeUndefined();
  });
});

describe('activityRow', () => {
  it('writes as the caller in the request’s single company unless a company is named', () => {
    const row = activityRow(principal, 2, { type: 'customer_updated', accountId });
    expect(row).toMatchObject({
      entityId: 2,
      opportunityId: null,
      accountId,
      actorPrincipalId: principal.id,
      payloadJson: {},
      body: null,
    });
    expect(activityRow(principal, 2, { type: 'won', accountId, entityId: 3 }).entityId).toBe(3);
  });

  it('refuses a row that names no company in a request for several', () => {
    expect(() => activityRow(principal, undefined, { type: 'won', accountId })).toThrow(
      /names no company/,
    );
  });

  it('keeps text to a note, within its length in characters', () => {
    expect(() => activityRow(principal, 1, { type: 'won', accountId, body: 'text' })).toThrow();
    expect(() => activityRow(principal, 1, { type: 'note', accountId })).toThrow();
    expect(() => activityRow(principal, 1, { type: 'note', accountId, body: '' })).toThrow();
    // 2,000 characters, some of them outside the basic plane, fit.
    const note = '😀'.repeat(1000) + 'a'.repeat(1000);
    expect(activityRow(principal, 1, { type: 'note', accountId, body: note }).body).toBe(note);
    expect(() =>
      activityRow(principal, 1, { type: 'note', accountId, body: `${note}a` }),
    ).toThrow();
  });

  it('refuses a payload that is not ids, codes, counts or labels', () => {
    expect(() =>
      activityRow(principal, 1, {
        type: 'customer_updated',
        accountId,
        payload: { email: 'a@b.in' },
      }),
    ).toThrow(/payload refused/);
  });
});
