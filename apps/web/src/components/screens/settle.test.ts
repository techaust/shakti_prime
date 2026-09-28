import { describe, expect, it } from 'vitest';
import type { ActionResult } from '../../actions/result';
import { settle } from './settle';

describe('settle', () => {
  it('passes a successful answer through', async () => {
    const answer: ActionResult<number> = { ok: true, data: 7 };
    await expect(settle(() => Promise.resolve(answer))).resolves.toEqual(answer);
  });

  it('passes a refusal through with its reference and field', async () => {
    const answer: ActionResult<number> = {
      ok: false,
      error: 'validation_failed',
      field: 'contact.phone',
    };
    await expect(settle(() => Promise.resolve(answer))).resolves.toEqual(answer);
  });

  it('answers the internal sentence when the call itself is rejected', async () => {
    await expect(
      settle<number>(() => Promise.reject(new TypeError('Failed to fetch'))),
    ).resolves.toEqual({ ok: false, error: 'internal' });
  });

  it('answers the internal sentence when the call throws before it starts', async () => {
    await expect(
      settle<number>(() => {
        throw new Error('the action was not found on the server');
      }),
    ).resolves.toEqual({ ok: false, error: 'internal' });
  });
});
