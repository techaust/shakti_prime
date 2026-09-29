import { newId } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_CODE_MAX, activityRow, payloadProblem } from './activity';

const principal = { id: newId() };
const accountId = newId();

describe('payloadProblem', () => {
  it('takes ids, codes, lists of codes, times, counts and flags', () => {
    expect(
      payloadProblem({
        opportunityId: newId(),
        stageKey: 'qualified',
        pipelineKey: 'rules-1a2b3c4d5e6f7a8b',
        changed: 'name,gstin',
        dueAt: '2026-10-01T04:00:00.000Z',
        count: 3,
        existingAccount: false,
        sourceCode: null,
      }),
    ).toBeUndefined();
  });

  it('takes a code of exactly the longest length and refuses one character more', () => {
    expect(payloadProblem({ code: 'a'.repeat(ACTIVITY_CODE_MAX) })).toBeUndefined();
    expect(payloadProblem({ code: 'a'.repeat(ACTIVITY_CODE_MAX + 1) })).toMatch(/longer/);
  });

  it('refuses a name, an email address, a phone number or free text', () => {
    for (const value of ['Mela @ Sikar', 'ram@example.com', '+919876543210', 'Ramesh Kumar']) {
      expect(payloadProblem({ label: value })).toMatch(/not an id, code or count/);
    }
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
