import { describe, expect, it } from 'vitest';
import { formKeyFor, type FormKey } from './use-command';

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
