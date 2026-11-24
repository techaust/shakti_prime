import { type ImportJobDto, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createReadyImportFile,
  createTestPrincipal,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { Command } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { commitImportBatch, commitImportJob } from '../../src/commands/imports/commit-job';
import { createImportJob } from '../../src/commands/imports/create-job';
import { mapImportJob } from '../../src/commands/imports/map-job';
import { previewImportJob } from '../../src/commands/imports/preview-job';
import { rollbackImportJob } from '../../src/commands/imports/rollback-job';
import { reverseStock } from '../../src/commands/inventory/stock';
import { parseImportFile } from '../../src/imports/parse';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listImportRows } from '../../src/queries/imports/import-queries';
import { getStockCard } from '../../src/queries/inventory/stock';
import { stockMove } from '../../src/stock/move';
import {
  averageOf,
  onHand,
  serialOf,
  stockFixture,
  type StockFixture,
} from '../stock/stock-fixture';

/**
 * H1's opening stock import (docs/03-roadmap-appendix/phase3.md §6.2) on real Postgres: rows found
 * by hub, bin and stock code, a serial per row of a tracked item, posted under the job as one
 * opening; a company's second opening refused until the first is undone whole. Company 3 is this
 * file's (the ledger's own tests use company 4).
 */

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

const ENTITY = 3;
let exec: Principal;
let f: StockFixture;

function run<I extends z.ZodType, O extends z.ZodType>(
  command: Command<I, O>,
  input: unknown,
): Promise<z.output<O>> {
  return asPrincipal({ ...exec, entityIds: [ENTITY] }, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

/** The mapping, keeping only the columns a file has. */
function mappingFor(columns: readonly string[]) {
  return {
    columns: Object.fromEntries(
      Object.entries(MAPPING.columns).filter(([, column]) => columns.includes(column)),
    ),
  };
}

const MAPPING = {
  columns: {
    hub: 'Hub',
    bin: 'Bin',
    sku: 'SKU',
    qty: 'Qty',
    unitCost: 'Cost',
    serialNo: 'Serial',
    company: 'Company',
  },
};

async function previewed(csv: string): Promise<ImportJobDto> {
  const parsed = await parseImportFile(new TextEncoder().encode(csv));
  const fileId = await createReadyImportFile(ENTITY, exec.id, { name: 'opening.csv' });
  const job = await run(createImportJob, {
    entityId: ENTITY,
    kind: 'opening_stock',
    fileId,
    format: parsed.format,
    columns: parsed.columns,
    rows: parsed.rows,
  });
  await run(mapImportJob, { entityId: ENTITY, jobId: job.id, mapping: mappingFor(parsed.columns) });
  return run(previewImportJob, { entityId: ENTITY, jobId: job.id });
}

async function committed(job: ImportJobDto): Promise<ImportJobDto> {
  let current = await run(commitImportJob, { entityId: ENTITY, jobId: job.id });
  while (current.state === 'committing') {
    current = await run(commitImportBatch, { entityId: ENTITY, jobId: job.id });
  }
  return current;
}

/** Any opening stock of company 3 a stopped run left behind is reversed first. */
async function clearOpenings(): Promise<void> {
  const open = await asMigrator(
    (m) => m<{ id: string }[]>`
      select m.id from stock_movements m
       where m.entity_id = ${ENTITY} and m.reason = 'opening'
         and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`,
  );
  if (open.length > 0) {
    await asPrincipal(exec, ({ tx }) =>
      stockMove(
        tx,
        open.map((o) => ({ reason: 'reversal' as const, reversesId: o.id })),
      ),
    );
  }
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  f = await stockFixture(exec.id);
  await clearOpenings();
});
afterAll(clearOpenings);

describe('the opening stock import', () => {
  it('checks each row against the hubs, bins, items and serials, and posts the valid ones as one opening', async () => {
    const code = await asMigrator(
      (m) => m<{ code: string }[]>`select code from entities where id = ${ENTITY}`,
    );
    const csv = [
      'Hub,Bin,SKU,Qty,Cost,Serial,Company',
      `H${f.tag},A1,SC-${f.tag},12.5,100,,`,
      `h${f.tag},b1,sc-${f.tag},"1,000",80.25,,${code[0]?.code ?? ''}`,
      `H${f.tag},A1,SP-${f.tag},,5000,OS-${f.tag}-1,`,
      `H${f.tag},A1,SP-${f.tag},1,5000,OS-${f.tag}-2,`,
      // Refused: an unknown hub, a bin of no hub, an unknown code, a serial twice, a serial on
      // an untracked item, none on a tracked one, an inactive item, another company.
      `X${f.tag},A1,SC-${f.tag},1,1,,`,
      `H${f.tag},NOPE,SC-${f.tag},1,1,,`,
      `H${f.tag},A1,NO-${f.tag},1,1,,`,
      `H${f.tag},A1,SP-${f.tag},1,5000,os-${f.tag}-1,`,
      `H${f.tag},A1,SC-${f.tag},1,1,OS-${f.tag}-9,`,
      `H${f.tag},A1,SP-${f.tag},1,5000,,`,
      `H${f.tag},A1,SI-${f.tag},1,1,,`,
      `H${f.tag},A1,SC-${f.tag},1,1,,ANOTHER`,
    ].join('\n');
    const job = await previewed(csv);
    expect(job).toMatchObject({ state: 'previewed', validRows: 4, invalidRows: 8 });
    const page = await asPrincipal({ ...exec, entityIds: [ENTITY] }, (ctx) =>
      listImportRows(ctx, { entityId: ENTITY, jobId: job.id, limit: 50 }),
    );
    const codes = page.rows
      .filter((r) => r.state === 'invalid')
      .map((r) => r.errors.map((e) => e.code).join('+'));
    expect(codes).toEqual([
      'hub_unknown',
      'bin_unknown',
      'sku_unknown',
      'serial_taken',
      'serial_not_tracked',
      'serial_required',
      'item_not_stockable',
      'company_mismatch',
    ]);

    const done = await committed(job);
    expect(done).toMatchObject({ state: 'committed', committedRows: 4 });
    expect(await onHand(ENTITY, f.binA, f.cable)).toBe('12.500');
    expect(await onHand(ENTITY, f.binB, f.cable)).toBe('1000.000');
    expect(await onHand(ENTITY, f.binA, f.pump)).toBe('2.000');
    expect(await serialOf(f.pump, `OS-${f.tag}-2`)).toMatchObject({ state: 'in_stock' });
    // 12.5 at 100 and 1,000 at 80.25: the company's average.
    expect((await averageOf(ENTITY, f.cable)).avg).toBe('80.4938');
    const refs = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from stock_movements
         where entity_id = ${ENTITY} and reason = 'opening' and ref_type = 'import_job' and ref_id = ${job.id}`,
    );
    expect(refs[0]?.n).toBe(4);

    // A second file for the company is refused at its preview, every row.
    const second = await previewed(`Hub,Bin,SKU,Qty,Cost\nH${f.tag},A1,SC-${f.tag},1,1`);
    expect(second).toMatchObject({ validRows: 0, invalidRows: 1 });

    // Undoing the first reverses each movement; then a new opening may come in.
    const undone = await run(rollbackImportJob, { entityId: ENTITY, jobId: job.id });
    expect(undone.state).toBe('rolled_back');
    expect(await onHand(ENTITY, f.binA, f.cable)).toBe('0.000');
    expect(await serialOf(f.pump, `OS-${f.tag}-1`)).toMatchObject({ state: 'scrapped' });
    const third = await previewed(`Hub,Bin,SKU,Qty,Cost\nH${f.tag},A1,SC-${f.tag},3,90`);
    expect(third.validRows).toBe(1);
    expect((await committed(third)).state).toBe('committed');
    expect(await onHand(ENTITY, f.binA, f.cable)).toBe('3.000');
  });

  it('is never reversed by hand, and its rollback passes over a line an earlier version reversed (review probe B)', async () => {
    await clearOpenings();
    const job = await committed(
      await previewed(
        [
          'Hub,Bin,SKU,Qty,Cost',
          `H${f.tag},A1,SC-${f.tag},5,50`,
          `H${f.tag},B1,SC-${f.tag},2,50`,
        ].join('\n'),
      ),
    );
    expect(job.state).toBe('committed');
    const lines = await asMigrator(
      (m) => m<{ id: string }[]>`
        select id from stock_movements
         where entity_id = ${ENTITY} and reason = 'opening' and ref_id = ${job.id}
         order by qty desc`,
    );
    expect(lines).toHaveLength(2);
    // The A1 line (5) first, the B1 line (2) second: ids made in one batch carry no order.
    const [first, second] = lines.map((l) => l.id);

    // The stock card offers no Reverse on an opening line, and the command refuses one.
    const card = await asPrincipal({ ...exec, entityIds: [ENTITY] }, (ctx) =>
      getStockCard(ctx, { entityId: ENTITY, itemId: f.cable, limit: 50 }),
    );
    const openings = card.movements.filter((m) => m.reason === 'opening');
    expect(openings.length).toBeGreaterThanOrEqual(2);
    expect(openings.every((m) => !m.reversible)).toBe(true);
    await expect(
      run(reverseStock, { entityId: ENTITY, movementId: first ?? '' }),
    ).rejects.toMatchObject({ details: { reason: 'stock_reversal_not_allowed' } });

    // An earlier version's stock card could reverse one line by hand: the definer still does.
    await asPrincipal(exec, ({ tx }) =>
      stockMove(tx, [{ reason: 'reversal', reversesId: first ?? '' }]),
    );
    expect(await onHand(ENTITY, f.binA, f.cable)).toBe('0.000');

    // The rollback reverses only the line left, and the company may take a new opening.
    const undone = await run(rollbackImportJob, { entityId: ENTITY, jobId: job.id });
    expect(undone.state).toBe('rolled_back');
    const reversals = await asMigrator(
      (m) => m<{ reverses: string; n: number }[]>`
        select reverses_id as reverses, count(*)::int as n from stock_movements
         where reverses_id in (${first ?? ''}, ${second ?? ''}) group by reverses_id order by reverses_id`,
    );
    expect(reversals.map((r) => r.n)).toEqual([1, 1]);
    expect(await onHand(ENTITY, f.binB, f.cable)).toBe('0.000');
    const next = await previewed(`Hub,Bin,SKU,Qty,Cost\nH${f.tag},A1,SC-${f.tag},1,40`);
    expect(next.validRows).toBe(1);
  });

  it('is refused to a holder of imports.write without finance.cost.read, who never reads its rows', async () => {
    const gm = await createTestPrincipal('general_manager', [ENTITY]);
    const parsed = await parseImportFile(
      new TextEncoder().encode(`Hub,Bin,SKU,Qty,Cost\nH${f.tag},A1,SC-${f.tag},1,1`),
    );
    const fileId = await createReadyImportFile(ENTITY, gm.id, { name: 'opening.csv' });
    await expect(
      asPrincipal(gm, (context) =>
        runCommand(
          createImportJob,
          { context, audit, outbox },
          {
            entityId: ENTITY,
            kind: 'opening_stock',
            fileId,
            format: parsed.format,
            columns: parsed.columns,
            rows: parsed.rows,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // The Executive's job, its rows and its file stay out of the General Manager's sight.
    const job = await previewed(`Hub,Bin,SKU,Qty,Cost\nH${f.tag},A1,SC-${f.tag},1,77.5`);
    const seen = await asPrincipal(gm, async ({ tx }) => {
      const rows = (await tx.execute(sql`
        select (select count(*)::int from import_rows where job_id = ${job.id}) as rows,
               (select count(*)::int from import_jobs where id = ${job.id}) as jobs,
               (select count(*)::int from files f join import_jobs j on j.file_id = f.id
                 where j.id = ${job.id}) as files`)) as unknown as {
        rows: number;
        jobs: number;
        files: number;
      }[];
      return rows[0];
    });
    expect(seen).toEqual({ rows: 0, jobs: 1, files: 0 });
  });
});
