import { IdSchema, newId, type PermissionGrant, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  grantsForRole,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { defineCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { commitLeadBatch, RowByRowNeeded } from '../../src/imports/commit-leads';
import { importRowKey } from '../../src/imports/row-key';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// The import commits a batch of plain new leads in a few statements (`commitLeadBatch`) and
// anything else row by row through `crm.lead.create` (`imports.job.commit_batch`). The two must
// leave the same rows behind, or a lead from a file differs from one typed in. This test makes
// the same leads both ways and compares every row they write, column by column, so a rule added
// to one path and not the other fails here.

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

const BatchRows = z.array(z.object({ rowNo: z.number().int(), input: z.unknown() }).strict());
const Made = z.array(z.object({ rowNo: z.number().int(), id: IdSchema }).strict());
const BatchInput = z.object({ jobId: IdSchema, rows: BatchRows }).strict();
const LEAD_WRITE = [
  { permission: 'crm.lead.write', minScope: 'own' },
  { permission: 'crm.account.write', minScope: 'own' },
] as const;

/** The set-based path, as `imports.job.commit_batch` calls it first. */
const setBased = defineCommand({
  name: 'test.imports.parity.set_based',
  permission: 'imports.write',
  minScope: 'entity',
  alsoRequires: LEAD_WRITE,
  auditFields: [],
  input: BatchInput,
  output: Made,
  handler: (ctx, input) => commitLeadBatch(ctx, ctx.tx, input.jobId, input.rows),
});

/** The row-by-row path, as `imports.job.commit_batch` falls back to it. */
const rowByRow = defineCommand({
  name: 'test.imports.parity.row_by_row',
  permission: 'imports.write',
  minScope: 'entity',
  alsoRequires: LEAD_WRITE,
  auditFields: [],
  input: BatchInput,
  output: Made,
  async handler(ctx, input) {
    const made: { rowNo: number; id: string }[] = [];
    for (const row of input.rows) {
      const lead = await ctx.run(createLead, row.input, {
        idempotencyKey: importRowKey(input.jobId, row.rowNo),
        auditedByCaller: true,
      });
      made.push({ rowNo: row.rowNo, id: lead.id });
    }
    return made;
  },
});

function run(
  principal: Principal,
  command: typeof setBased,
  input: z.input<typeof BatchInput>,
): Promise<z.output<typeof Made>> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

/** A mobile number no earlier run used. */
function phone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

type Row = Record<string, unknown>;
type Snapshot = Record<string, Row[]>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Every row the leads wrote, read past the policies, with the ids each path made itself named by
 * their place (`account#0`, the caller as `actor`), other new ids and times blanked, and ids both
 * paths share (pipeline, stage, source, team) kept as they are.
 */
async function snapshot(
  actor: string,
  made: readonly { rowNo: number; id: string }[],
  job: string = jobId,
) {
  const ids = made.map((m) => m.id);
  const keys = made.map((m) => importRowKey(job, m.rowNo));
  const raw = await asMigrator(async (m) => {
    const opportunities = await m<Row[]>`select * from opportunities where id = any(${ids})`;
    const accountIds = opportunities.map((o) => o.account_id as string);
    const accountContacts = await m<Row[]>`
      select * from account_contacts where account_id = any(${accountIds})`;
    const contactIds = accountContacts.map((c) => c.contact_id as string);
    return {
      opportunities,
      accounts: await m<Row[]>`select * from accounts where id = any(${accountIds})`,
      account_entities: await m<Row[]>`
        select * from account_entities where account_id = any(${accountIds})`,
      account_contacts: accountContacts,
      contacts: await m<Row[]>`select * from contacts where id = any(${contactIds})`,
      contact_phones: await m<Row[]>`
        select * from contact_phones where contact_id = any(${contactIds})`,
      customer_sites: await m<Row[]>`
        select * from customer_sites where account_id = any(${accountIds})`,
      consents: await m<Row[]>`select * from consents where contact_id = any(${contactIds})`,
      activities: await m<Row[]>`select * from activities where account_id = any(${accountIds})`,
      idempotency_keys: await m<Row[]>`
        select * from idempotency_keys where principal_id = ${actor} and key = any(${keys})`,
      // Delivery columns change as the publisher runs; what was emitted is what must match.
      outbox_events: await m<Row[]>`
        select type, entity_id, aggregate_type, aggregate_id, payload_json
          from outbox_events where aggregate_id = any(${ids})`,
    };
  });

  // Names for the ids each lead made, by the lead's place in the file.
  const labels = new Map<string, string>([[actor, 'actor']]);
  made.forEach((m, i) => {
    const opportunity = raw.opportunities.find((o) => o.id === m.id);
    labels.set(m.id, `opportunity#${String(i)}`);
    const accountId = opportunity?.account_id as string;
    labels.set(accountId, `account#${String(i)}`);
    const owner = raw.account_contacts.find((c) => c.account_id === accountId);
    labels.set(owner?.contact_id as string, `contact#${String(i)}`);
    const siteId = opportunity?.site_id;
    if (typeof siteId === 'string') labels.set(siteId, `site#${String(i)}`);
  });
  // Every other id a row of this path carries as its own is new to this path.
  const own = new Set(
    Object.values(raw).flatMap((rows) => rows.map((r) => r.id).filter((id) => id !== undefined)),
  );

  const normalise = (value: unknown): unknown => {
    if (value instanceof Date) return '<time>';
    if (typeof value === 'string') {
      const label = labels.get(value);
      if (label !== undefined) return label;
      if (UUID.test(value) && own.has(value)) return '<new id>';
      if (ISO_TIME.test(value)) return '<time>';
      return value;
    }
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(normalise);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v)]));
    }
    return value;
  };
  const out: Snapshot = {};
  for (const [table, rows] of Object.entries(raw)) {
    out[table] = rows
      .map((r) => normalise({ ...r }) as Row)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return out;
}

let teamId: string;
let importerA: Principal;
let importerB: Principal;
// One job id for both paths: each row's key `import:{job}:{row}` is then the same on both sides.
const jobId = newId();

beforeAll(async () => {
  teamId = await createTestTeam(1, 'import parity team');
  importerA = await createTestPrincipal('general_manager', [1], { teamId });
  importerB = await createTestPrincipal('general_manager', [1], { teamId });
});

describe('an import batch set-based and row by row', () => {
  it('leaves the same rows behind, column by column', async () => {
    const rows = [
      {
        rowNo: 2,
        input: {
          entityId: 1,
          pipelineKey: 'farmer_pumps',
          contact: { name: 'Bhanwar Lal', phone: phone() },
          account: { type: 'farm' },
          site: { type: 'borewell', village: 'Jhunjhunu', pin: '333001' },
          sourceCode: 'import',
        },
      },
      {
        rowNo: 3,
        input: {
          entityId: 1,
          pipelineKey: 'residential_rooftop',
          contact: { name: 'Kamla Devi', phone: phone(), preferredLanguage: 'en' },
          account: { type: 'household', name: 'Kamla Devi house' },
          site: { type: 'rooftop', village: 'Sikar' },
        },
      },
      {
        rowNo: 5,
        input: {
          entityId: 1,
          pipelineKey: 'commercial_epc',
          contact: { name: 'Ramesh Traders', phone: phone() },
          account: { type: 'business', name: 'Ramesh Traders' },
          sourceCode: 'walk_in',
        },
      },
    ];

    const a = await run(importerA, setBased, { jobId, rows });
    const b = await run(importerB, rowByRow, { jobId, rows });
    expect(a.map((m) => m.rowNo)).toEqual([2, 3, 5]);
    expect(b.map((m) => m.rowNo)).toEqual([2, 3, 5]);

    const left = await snapshot(importerA.id, a);
    const right = await snapshot(importerB.id, b);

    // Each table holds what three new leads make, so the comparison below is never of nothing.
    const counts = Object.fromEntries(Object.entries(left).map(([t, r]) => [t, r.length]));
    expect(counts).toEqual({
      opportunities: 3,
      accounts: 3,
      account_entities: 3,
      account_contacts: 3,
      contacts: 3,
      contact_phones: 3,
      customer_sites: 2,
      consents: 0,
      activities: 3,
      idempotency_keys: 3,
      outbox_events: 3,
    });
    // Each key keeps the lead's answer, so a repeat of the row replays it.
    const answer = left.idempotency_keys?.[0];
    expect(answer).toMatchObject({ command: 'crm.lead.create', principal_id: 'actor' });
    expect(String((answer?.response_json as Row | undefined)?.id)).toMatch(/^opportunity#/);

    for (const table of Object.keys(right)) expect(left[table], table).toEqual(right[table]);
    expect(Object.keys(left)).toEqual(Object.keys(right));
  });

  it('leaves a consent, or a customer the group knows, to crm.lead.create', async () => {
    const plain = {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Savitri', phone: phone() },
      account: { type: 'farm' },
    };
    const withConsent = {
      ...plain,
      consent: {
        channel: 'whatsapp',
        purpose: 'service',
        source: 'walk_in_form',
        textVersion: 'v1',
      },
    };
    const known = { ...plain, contact: undefined, account: undefined, existingAccountId: newId() };
    for (const input of [withConsent, known]) {
      await expect(
        run(importerA, setBased, { jobId: newId(), rows: [{ rowNo: 2, input }] }),
      ).rejects.toBeInstanceOf(RowByRowNeeded);
    }
  });

  it('gives the answer crm.lead.create gives for a number a colleague’s customer has (0055)', async () => {
    const known = phone();
    const colleague = await createTestPrincipal('tele_caller_cc', [1]);
    await asPrincipal(colleague, (context) =>
      runCommand(
        createLead,
        { context, audit, outbox },
        {
          entityId: 1,
          pipelineKey: 'farmer_pumps',
          contact: { name: 'Known number', phone: known },
          account: { type: 'farm' },
        },
      ),
    );
    const rows = [
      {
        rowNo: 2,
        input: {
          entityId: 1,
          pipelineKey: 'farmer_pumps',
          contact: { name: 'Known number again', phone: known },
          account: { type: 'farm' },
          site: { type: 'borewell', village: 'Churu' },
        },
      },
      {
        rowNo: 3,
        input: {
          entityId: 1,
          pipelineKey: 'farmer_pumps',
          contact: { name: 'New number', phone: phone() },
          account: { type: 'farm' },
        },
      },
    ];

    // Importers who may act for the colleague (company scope) make a new customer both ways, as
    // the command does, and leave the same rows behind.
    const knownJob = newId();
    const a = await run(importerA, setBased, { jobId: knownJob, rows });
    const b = await run(importerB, rowByRow, { jobId: knownJob, rows });
    const left = await snapshot(importerA.id, a, knownJob);
    const right = await snapshot(importerB.id, b, knownJob);
    expect(left.opportunities).toHaveLength(2);
    for (const table of Object.keys(right)) expect(left[table], table).toEqual(right[table]);

    // An importer whose customer scope is their own may not: the set-based path leaves the batch
    // to the row-by-row path, which refuses the row exactly as crm.lead.create refuses it.
    const permissions: PermissionGrant[] = grantsForRole('general_manager').map((g) =>
      g.key.startsWith('crm.lead.') || g.key.startsWith('crm.account.')
        ? { key: g.key, scope: 'own' }
        : g,
    );
    const narrow = await createTestPrincipal('general_manager', [1], { teamId, permissions });
    const refused = { code: 'conflict', details: { reason: 'customer_held_by_colleague' } };
    await expect(run(narrow, setBased, { jobId: newId(), rows })).rejects.toBeInstanceOf(
      RowByRowNeeded,
    );
    await expect(run(narrow, rowByRow, { jobId: newId(), rows })).rejects.toMatchObject(refused);
    await expect(
      asPrincipal(narrow, (context) =>
        runCommand(createLead, { context, audit, outbox }, rows[0]?.input),
      ),
    ).rejects.toMatchObject(refused);
  });
});
