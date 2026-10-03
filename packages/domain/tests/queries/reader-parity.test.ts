import { newId, type Principal, type RoleKey } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { closeDb, PIPELINE_SEED, principalFor, STAGE_SEED } from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { executeQuery } from '../../src/command/execute';
import { listUsers, listUserSessions } from '../../src/queries/admin/list-users';
import { searchPeople } from '../../src/queries/admin/search-people';
import { listAuditPeople, queryAudit } from '../../src/queries/audit/query-audit';
import { listItems, listItemsWithCost } from '../../src/queries/catalogue/list-items';
import { listSizingPumps } from '../../src/queries/catalogue/list-sizing-pumps';
import { listBoardLeads, listBoardStageLeads } from '../../src/queries/crm/list-board-leads';
import { listLeadAssignees } from '../../src/queries/crm/list-lead-assignees';
import { latestSizing } from '../../src/queries/crm/latest-sizing';
import { countLeads, listLeads } from '../../src/queries/crm/list-leads';
import { listLeadSources, listPipelines } from '../../src/queries/crm/list-pipelines';
import { searchLeads } from '../../src/queries/crm/search-leads';
import {
  getImportJob,
  listImportJobs,
  listImportRows,
  listImportTemplates,
} from '../../src/queries/imports/import-queries';
import { listEntities } from '../../src/queries/org/list-entities';
import { readOutboxHealth } from '../../src/queries/platform/outbox-health';
import { listPriceLists, listPrices } from '../../src/queries/pricing/list-prices';
import { listSavedViews } from '../../src/queries/profile/saved-views';

afterAll(closeDb);

/**
 * docs/design/phase1.md §5.2: every query the app runs reads the same through the `app_reader`
 * pool as through `app_user` in a read-only transaction, for each kind of caller. The suite runs
 * with `DATABASE_URL_READER` set, so `executeQuery()` picks the reader by itself; each query runs
 * on both pools and the answers, or the refusals, must be equal.
 */
const WEEK_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const NOW = new Date(Date.now() + 60_000).toISOString();
const PIPELINE = PIPELINE_SEED[0]?.key ?? 'farmer_pumps';
const STAGE = STAGE_SEED[0]?.id ?? newId();

const QUERIES: Record<string, (ctx: RequestContext) => Promise<unknown>> = {
  listUsers: (ctx) => listUsers(ctx, { limit: 20 }),
  listUserSessions: (ctx) => listUserSessions(ctx, { userId: ctx.principal.id }),
  searchPeople: (ctx) => searchPeople(ctx, { q: 'kum' }),
  queryAudit: (ctx) => queryAudit(ctx, { from: WEEK_AGO, to: NOW, limit: 20 }),
  listAuditPeople: (ctx) => listAuditPeople(ctx, { from: WEEK_AGO, to: NOW }),
  listItems: (ctx) => listItems(ctx, { limit: 20 }),
  listItemsWithCost: (ctx) => listItemsWithCost(ctx, 1, { limit: 20 }),
  listBoardLeads: (ctx) => listBoardLeads(ctx, { pipelineKey: PIPELINE }),
  listBoardStageLeads: (ctx) =>
    listBoardStageLeads(ctx, { pipelineKey: PIPELINE, stageId: STAGE, cursor: 'bm8' }),
  listLeadAssignees: (ctx) => listLeadAssignees(ctx, { entityId: 1 }),
  listLeads: (ctx) => listLeads(ctx, { limit: 20 }),
  countLeads: (ctx) => countLeads(ctx),
  listPipelines: (ctx) => listPipelines(ctx),
  listLeadSources: (ctx) => listLeadSources(ctx),
  searchLeads: (ctx) => searchLeads(ctx, { q: 'ram' }),
  getImportJob: (ctx) => getImportJob(ctx, { entityId: 1, jobId: newId() }),
  listImportJobs: (ctx) => listImportJobs(ctx, { entityId: 1, limit: 20 }),
  listImportRows: (ctx) => listImportRows(ctx, { entityId: 1, jobId: newId(), limit: 20 }),
  listImportTemplates: (ctx) => listImportTemplates(ctx, { entityId: 1, kind: 'leads' }),
  listEntities: (ctx) => listEntities(ctx),
  readOutboxHealth: (ctx) => readOutboxHealth(ctx, { limit: 20 }),
  listPriceLists: (ctx) => listPriceLists(ctx, new Date('2026-09-29T00:00:00Z')),
  listPrices: (ctx) => listPrices(ctx, { priceListId: newId(), limit: 20 }),
  listSavedViews: (ctx) => listSavedViews(ctx, { screen: 'leads' }),
  listSizingPumps: (ctx) => listSizingPumps(ctx),
};

/**
 * Reads the app runs whose names the export check below does not match; each still runs on both
 * pools for every caller.
 */
const OTHER_READS: Record<string, (ctx: RequestContext) => Promise<unknown>> = {
  latestSizing: (ctx) => latestSizing(ctx, { entityId: 1, opportunityId: newId() }),
};

/** The answer, or the refusal's code, so a query that refuses one pool must refuse the other. */
async function outcome(
  principal: Principal,
  pool: 'reader' | 'app_user',
  query: (ctx: RequestContext) => Promise<unknown>,
): Promise<unknown> {
  try {
    return { ok: await executeQuery(principal, {}, query, { name: 'readerParity', pool }) };
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : undefined;
    return { refused: typeof code === 'string' ? code : (cause?.message ?? String(e)) };
  }
}

const CALLERS: { role: RoleKey; entities: number[] }[] = [
  { role: 'executive', entities: [1, 2, 3, 4] },
  { role: 'executive', entities: [2] },
  { role: 'general_manager', entities: [1] },
  { role: 'accounts', entities: [1] },
  { role: 'tele_caller_cc', entities: [1] },
  { role: 'agent:chief', entities: [1] },
  { role: 'system:workers', entities: [1] },
];

describe('every query reads the same on the reader pool as on app_user', () => {
  it('covers every query the domain exports', async () => {
    const domain = await import('../../src/index');
    const exported = Object.entries(domain)
      .filter(([name, value]) => typeof value === 'function' && QUERY_NAMES.test(name))
      .map(([name]) => name)
      .sort();
    expect(exported).toEqual(Object.keys(QUERIES).sort());
  });

  for (const { role, entities } of CALLERS) {
    it(`for ${role} in ${entities.join(', ')}`, async () => {
      // One principal row for both pools, so the queries that read "my own" rows match.
      const principal = principalFor(role, entities, { id: newId() });
      for (const [name, query] of Object.entries({ ...QUERIES, ...OTHER_READS })) {
        const reader = await outcome(principal, 'reader', query);
        const app = await outcome(principal, 'app_user', query);
        expect({ name, reader }).toEqual({ name, reader: app });
      }
    });
  }
});

/** The names of the exported read functions: `list…`, `search…`, `get…`, `count…`, `query…`, `read…`. */
const QUERY_NAMES = /^(list|search|get(?!Command)|count|query|read)[A-Z]/;
