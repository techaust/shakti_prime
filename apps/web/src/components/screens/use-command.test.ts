import { describe, expect, it } from 'vitest';
import { formKeyFor, runKeyFor, signInAfter, type FormKey } from './use-command';

describe('formKeyFor', () => {
  let made = 0;
  const fresh = () => {
    made += 1;
    return `key-${String(made)}`;
  };

  it('keeps the key while the form is the same and not saved, so a retry acts once', () => {
    const first = formKeyFor(undefined, 'lead-a', fresh);
    expect(formKeyFor(first, 'lead-a', fresh)).toBe(first);
  });

  it('gives another form a key of its own, and the first form a new one when it comes back', () => {
    const a = formKeyFor(undefined, 'lead-a', fresh);
    const b = formKeyFor(a, 'lead-b', fresh);
    expect(b).toMatchObject({ form: 'lead-b' });
    expect(b.key).not.toBe(a.key);
    expect(formKeyFor(b, 'lead-a', fresh).key).not.toBe(a.key);
  });

  it('gives a new key after a save, and keeps one for a form with no name', () => {
    const saved: FormKey | undefined = undefined;
    const before = formKeyFor(undefined, 'lead-a', fresh);
    expect(formKeyFor(saved, 'lead-a', fresh).key).not.toBe(before.key);
    const unnamed = formKeyFor(undefined, undefined, fresh);
    expect(formKeyFor(unnamed, undefined, fresh)).toBe(unnamed);
  });
});

describe('runKeyFor (WEB-5)', () => {
  let made = 0;
  const fresh = () => {
    made += 1;
    return `run-${String(made)}`;
  };
  const rowA = JSON.stringify({ taskId: 'a' });
  const rowB = JSON.stringify({ taskId: 'b' });

  it("gives a second row's run its own key while the first row's is in flight", () => {
    const a = runKeyFor(undefined, undefined, rowA, new Map(), fresh);
    const b = runKeyFor(a, undefined, rowB, new Map([[rowA, a.key]]), fresh);
    expect(b.key).not.toBe(a.key);
  });

  it('keeps the key for a double press with the same details, so it acts once', () => {
    const a = runKeyFor(undefined, undefined, rowA, new Map(), fresh);
    expect(runKeyFor(a, undefined, rowA, new Map([[rowA, a.key]]), fresh)).toBe(a);
  });

  it('keeps the key for a retry after a failure, when nothing is in flight', () => {
    const a = runKeyFor(undefined, undefined, rowA, new Map(), fresh);
    expect(runKeyFor(a, undefined, rowB, new Map(), fresh)).toBe(a);
  });
});

describe('signInAfter (WEB-7, WEB-V1)', () => {
  it('sends an ended sign-in to sign-in, back to this screen afterwards', () => {
    expect(signInAfter('unauthorized', '/calling')).toBe(
      '/sign-in?reason=session_ended&returnTo=%2Fcalling',
    );
  });

  it('keeps every other failure on the screen', () => {
    expect(signInAfter('forbidden', '/calling')).toBeUndefined();
    expect(signInAfter('totp_required', '/calling')).toBeUndefined();
    expect(signInAfter('internal', '/calling')).toBeUndefined();
  });
});
