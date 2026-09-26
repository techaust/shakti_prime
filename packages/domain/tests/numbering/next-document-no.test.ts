import { asPrincipal, closeDb, principalFor } from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { nextDocumentNo } from '../../src/numbering/next-document-no';

afterAll(closeDb);

const now = new Date('2026-09-27T10:00:00Z');

describe('nextDocumentNo', () => {
  it('issues consecutive numbers in the financial year of the instant', async () => {
    const exec = principalFor('executive', [1]);
    const a = await asPrincipal(exec, ({ tx }) => nextDocumentNo({ tx, now }, 1, 'SS', 'challan'));
    const b = await asPrincipal(exec, ({ tx }) => nextDocumentNo({ tx, now }, 1, 'SS', 'challan'));
    expect(a.fy).toBe('2026-27');
    expect(b.no).toBe(a.no + 1);
    expect(a.formatted).toBe(`SS/DC/2026-27/${String(a.no).padStart(4, '0')}`);
    expect(Object.keys(a).sort()).toEqual(['docType', 'fy', 'no', 'formatted'].sort());
  });

  it('returns a number to the series when the transaction rolls back', async () => {
    const exec = principalFor('executive', [1]);
    let drawn = 0;
    await expect(
      asPrincipal(exec, async ({ tx }) => {
        drawn = (await nextDocumentNo({ tx, now }, 1, 'SS', 'sales_order')).no;
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    const again = await asPrincipal(exec, ({ tx }) =>
      nextDocumentNo({ tx, now }, 1, 'SS', 'sales_order'),
    );
    expect(again.no).toBe(drawn);
  });

  it('refuses an entity outside the request scope as forbidden', async () => {
    await expect(
      asPrincipal(principalFor('executive', [1]), ({ tx }) =>
        nextDocumentNo({ tx, now }, 2, 'SMP', 'quote'),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
