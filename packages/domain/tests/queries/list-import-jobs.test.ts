import { newId, type ImportJobDto, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { Command } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { createImportJob } from '../../src/commands/imports/create-job';
import { mapImportJob } from '../../src/commands/imports/map-job';
import { previewImportJob } from '../../src/commands/imports/preview-job';
import { parseImportFile } from '../../src/imports/parse';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  listImportJobs,
  listImportRows,
  listImportTemplates,
} from '../../src/queries/imports/import-queries';

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

/** A mobile number no earlier run used, so dedupe finds only what the test made. */
function phone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

function run<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  command: Command<I, O>,
  input: unknown,
): Promise<z.output<O>> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

/** A job for a CSV of the given rows, as the upload action makes it. */
async function uploadedJob(principal: Principal, entityId: number, rows: string[]) {
  const bytes = new TextEncoder().encode(`Name,Mobile,Village\n${rows.join('\n')}\n`);
  const parsed = await parseImportFile(bytes);
  return run(principal, createImportJob, {
    entityId,
    kind: 'leads',
    file: {
      name: `list-jobs-${newId()}.csv`,
      contentType: 'text/csv',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bucket: 'memory',
      key: `imports/${String(entityId)}/${newId()}`,
    },
    format: parsed.format,
    columns: parsed.columns,
    rows: parsed.rows,
  });
}

/** Every job the caller's list shows, following the cursor until `wanted` are all found. */
async function collect(
  principal: Principal,
  wanted: readonly string[],
  entityId?: number,
): Promise<{ jobs: ImportJobDto[]; creators: Record<string, string>; pages: number }> {
  const jobs: ImportJobDto[] = [];
  const creators: Record<string, string> = {};
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await asPrincipal(principal, (ctx) =>
      listImportJobs(ctx, { limit: 2, ...(entityId === undefined ? {} : { entityId }), cursor }),
    );
    pages += 1;
    jobs.push(...page.items);
    Object.assign(creators, page.creators);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined && !wanted.every((id) => jobs.some((j) => j.id === id)));
  return { jobs, creators, pages };
}

let gm: Principal;
let gm2: Principal;
let executive: Principal;

beforeAll(async () => {
  gm = await createTestPrincipal('general_manager', [1]);
  gm2 = await createTestPrincipal('general_manager', [2]);
  executive = await createTestPrincipal('executive', [1, 2]);
});

describe('listImportJobs', () => {
  it('is refused without the import permission', async () => {
    await expect(
      asPrincipal(principalFor('tele_caller_cc', [1]), (ctx) =>
        listImportJobs(ctx, { entityId: 1, limit: 25 }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('is refused for a company outside the request', async () => {
    await expect(
      asPrincipal(gm, (ctx) => listImportJobs(ctx, { entityId: 2, limit: 25 })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a cursor it did not make', async () => {
    await expect(
      asPrincipal(gm, (ctx) => listImportJobs(ctx, { cursor: 'not-a-cursor', limit: 25 })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('lists a company’s jobs newest first, a page at a time, with who started them', async () => {
    const first = await uploadedJob(gm, 1, [`Ganga,${phone()},Sikar`]);
    const second = await uploadedJob(gm, 1, [`Jamuna,${phone()},Churu`]);
    const third = await uploadedJob(gm, 1, [`Kaveri,${phone()},Nagaur`]);
    const other = await uploadedJob(gm2, 2, [`Narmada,${phone()},Bikaner`]);
    const ours = [third.id, second.id, first.id];

    const { jobs, creators, pages } = await collect(gm, ours, 1);
    expect(pages).toBeGreaterThan(1);
    expect(jobs.filter((j) => ours.includes(j.id)).map((j) => j.id)).toEqual(ours);
    expect(jobs.some((j) => j.id === other.id)).toBe(false);
    expect(jobs.every((j) => j.entityId === 1)).toBe(true);
    expect(new Set(jobs.map((j) => j.id)).size).toBe(jobs.length);
    expect(jobs.find((j) => j.id === first.id)).toMatchObject({
      state: 'uploaded',
      totalRows: 1,
      createdBy: gm.id,
      file: { name: first.file.name },
    });
    expect(creators[gm.id]).toBe('test general_manager');
  });

  it('lists every company of the request when no company is named', async () => {
    const inOne = await uploadedJob(executive, 1, [`Sutlej,${phone()},Jhunjhunu`]);
    const inTwo = await uploadedJob(executive, 2, [`Beas,${phone()},Alwar`]);
    const { jobs } = await collect(executive, [inOne.id, inTwo.id]);
    expect(jobs.map((j) => j.id)).toEqual(expect.arrayContaining([inOne.id, inTwo.id]));
    // A General Manager of the first company never sees the second company's job.
    const { jobs: gmJobs } = await collect(gm, [inOne.id]);
    expect(gmJobs.some((j) => j.id === inTwo.id)).toBe(false);
  });
});

describe('listImportRows', () => {
  it('names the customers a dedupe suggestion points at', async () => {
    const known = phone();
    const customerName = `Known farm ${newId().slice(-6)}`;
    const existing = await run(gm, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Known customer', phone: known },
      account: { type: 'farm', name: customerName },
    });
    const job = await uploadedJob(gm, 1, [`Known,${known},Jhunjhunu`, `Fresh,${phone()},Sikar`]);
    await run(gm, mapImportJob, {
      entityId: 1,
      jobId: job.id,
      mapping: {
        columns: { contactName: 'Name', phone: 'Mobile', village: 'Village' },
        defaults: { pipelineKey: 'farmer_pumps', accountType: 'farm', siteType: 'borewell' },
      },
    });
    await run(gm, previewImportJob, { entityId: 1, jobId: job.id });

    const page = await asPrincipal(gm, (ctx) =>
      listImportRows(ctx, { entityId: 1, jobId: job.id, limit: 50 }),
    );
    expect(page.rows[0]?.dedupe?.existing).toEqual([
      { accountId: existing.account.id, contactId: existing.contact?.id, matchedBy: 'phone' },
    ]);
    expect(page.customers).toEqual({ [existing.account.id]: customerName });
  });
});

describe('listImportTemplates', () => {
  it('lists the readable templates and leaves out one whose stored mapping no longer fits', async () => {
    const executive = await createTestPrincipal('executive');
    const tag = newId().slice(-8);
    const mapping = {
      columns: { contactName: 'Name', phone: 'Mobile', village: 'Village' },
      defaults: { pipelineKey: 'farmer_pumps', accountType: 'farm', siteType: 'borewell' },
    };
    await asMigrator(
      (
        m,
      ) => m`insert into import_mapping_templates (id, entity_id, kind, name, mapping_json, created_by)
        values (${newId()}, 1, 'leads', ${`Readable ${tag}`}, ${m.json(mapping)}, ${executive.id}),
               (${newId()}, 1, 'leads', ${`Unreadable ${tag}`}, '{}'::jsonb, ${executive.id})`,
    );
    const names = (
      await asPrincipal(executive, (ctx) =>
        listImportTemplates(ctx, { entityId: 1, kind: 'leads' }),
      )
    ).map((t) => t.name);
    expect(names).toContain(`Readable ${tag}`);
    expect(names).not.toContain(`Unreadable ${tag}`);
  });
});
