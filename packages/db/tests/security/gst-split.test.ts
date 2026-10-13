import type postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { asMigrator, closeDb } from '../../src/testing/index';

afterAll(async () => {
  await closeDb();
});

const CHECKS = [
  ['quotes', 'quotes_gst_split_check'],
  ['quote_lines', 'quote_lines_gst_split_check'],
  ['sales_orders', 'sales_orders_gst_split_check'],
  ['sales_order_lines', 'sales_order_lines_gst_split_check'],
] as const;

/** A rollback that carries the answer out of a transaction the test must leave as it found it. */
class Undo extends Error {
  constructor(readonly answer: unknown) {
    super('undo');
  }
}

/**
 * Runs `work` in a transaction as the table owner and rolls it back, answering what it answered
 * or the database's message when a statement failed.
 */
async function rolledBack(
  work: (tx: postgres.TransactionSql) => Promise<unknown>,
): Promise<unknown> {
  return asMigrator(async (m) => {
    try {
      await m.begin(async (tx) => {
        throw new Undo(await work(tx));
      });
    } catch (e) {
      if (e instanceof Undo) return e.answer;
      return e instanceof Error ? e.message : String(e);
    }
    return undefined;
  });
}

describe('the GST split of quotes and orders (audit 2026-10, DATA-7)', () => {
  it('holds a check on each header and line table', async () => {
    const rows = await asMigrator(
      (m) => m<{ table: string; name: string }[]>`
        select conrelid::regclass::text as table, conname as name from pg_constraint
         where conname = any(${CHECKS.map(([, name]) => name)})
         order by conname`,
    );
    expect(rows.map((r) => [r.table, r.name]).sort()).toEqual(
      CHECKS.map(([t, n]) => [t, n]).sort(),
    );
  });

  it('refuses IGST within the state, CGST or SGST across states, and a line with both', async () => {
    const cases = {
      header: [
        ['intra', 9, 9, 0, 'ok'],
        ['inter', 0, 0, 18, 'ok'],
        ['intra', 0, 0, 0, 'ok'],
        ['intra', 9, 9, 1, 'refused'],
        ['inter', 9, 0, 18, 'refused'],
        ['inter', 0, 9, 0, 'refused'],
      ],
      line: [
        ['intra', 9, 9, 0, 'ok'],
        ['intra', 0, 0, 18, 'ok'],
        ['intra', 9, 0, 18, 'refused'],
        ['intra', 0, 9, 18, 'refused'],
      ],
    } as const;
    for (const [table, name] of CHECKS) {
      const kind = table.endsWith('_lines') ? 'line' : 'header';
      // The real check, read from the table, on a scratch table of the four columns it names, so
      // the quotes and orders keep no row of this test.
      const outcomes = await rolledBack(async (tx) => {
        const [found] = await tx<{ def: string }[]>`
          select pg_get_constraintdef(oid) as def from pg_constraint where conname = ${name}`;
        await tx.unsafe(
          `create temp table split (supply_kind text, cgst numeric(14,2), sgst numeric(14,2),
                                    igst numeric(14,2)) on commit drop`,
        );
        await tx.unsafe(`alter table split add constraint ${name} ${found?.def ?? 'CHECK (false)'}`);
        const answers: string[] = [];
        for (const [supply, cgst, sgst, igst] of cases[kind]) {
          await tx.unsafe('savepoint row');
          try {
            await tx.unsafe('insert into split values ($1, $2, $3, $4)', [supply, cgst, sgst, igst]);
            answers.push('ok');
          } catch (e) {
            await tx.unsafe('rollback to savepoint row');
            answers.push(e instanceof Error && e.message.includes(name) ? 'refused' : String(e));
          }
        }
        return answers;
      });
      expect(outcomes, table).toEqual(cases[kind].map((c) => c[4]));
    }
  });

  it('the rows already stored meet every check, so the lead can validate them after the deploy', async () => {
    const answer = await rolledBack(async (tx) => {
      for (const [table, name] of CHECKS) {
        await tx.unsafe(`alter table ${table} validate constraint ${name}`);
      }
      return 'validated';
    });
    expect(answer).toBe('validated');
  });
});
