import { describe, expect, it } from 'vitest';
import { withoutPersonFields } from './library-log';

describe("Better Auth's log arguments", () => {
  it('lose every field that names a person, at any depth, and keep the rest', () => {
    // A synthetic record shaped like the user row and session Better Auth passes to its logger.
    const failure = new Error('lookup failed');
    const args = [
      {
        user: {
          id: 'u-1',
          name: 'Asha Meena',
          email: 'asha.meena@shakti.test',
          emailVerified: true,
          display_name: 'Asha',
        },
        session: { id: 's-1', user: { Name: 'Asha Meena', EMAIL: 'asha.meena@shakti.test' } },
        attempts: [{ userName: 'asha', full_name: 'Asha Meena', at: 3 }],
      },
      'plain text',
      failure,
    ];
    expect(withoutPersonFields(args)).toEqual([
      {
        user: { id: 'u-1', emailVerified: true },
        session: { id: 's-1', user: {} },
        attempts: [{ at: 3 }],
      },
      'plain text',
      failure,
    ]);
    expect(JSON.stringify(withoutPersonFields(args))).not.toMatch(/Asha|asha/);
  });

  it('leaves values that are not records as they are, and bounds deep nesting', () => {
    expect(withoutPersonFields(null)).toBeNull();
    expect(withoutPersonFields(7)).toBe(7);
    const at = new Date('2026-09-29T00:00:00Z');
    expect(withoutPersonFields(at)).toBe(at);
    let deep: Record<string, unknown> = { name: 'Asha' };
    for (let i = 0; i < 10; i += 1) deep = { d: deep };
    expect(JSON.stringify(withoutPersonFields(deep))).toContain('[deep]');
  });
});
