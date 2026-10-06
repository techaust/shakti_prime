import { newId, type Principal, type RoleKey } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { closeDb, PIPELINE_SEED, principalFor, STAGE_SEED } from '@shakti/db/testing';
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { executeQuery } from '../../src/command/execute';
import { countInbox, listInbox } from '../../src/queries/agents/inbox';
import { loadAgentSettings } from '../../src/queries/agents/settings';
import { fakeEmbedding } from '../../src/ai/transport';
import { listKnowledgeFiles, searchKnowledge } from '../../src/queries/knowledge/vault';
import { envelopeCipher, localKeyProvider } from '../../src/privacy/field-cipher';
import { listUsers, listUserSessions } from '../../src/queries/admin/list-users';
import { getRoleGrants, listRoles } from '../../src/queries/admin/roles';
import { searchPeople } from '../../src/queries/admin/search-people';
import { listAuditPeople, queryAudit } from '../../src/queries/audit/query-audit';
import { getItem, getKit, listKits } from '../../src/queries/catalogue/catalogue-queries';
import { listItems, listItemsWithCost } from '../../src/queries/catalogue/list-items';
import { listSizingPumps } from '../../src/queries/catalogue/list-sizing-pumps';
import {
  dialNumber,
  listCallQueue,
  listTeamQueues,
  loadCallLead,
} from '../../src/queries/calls/call-queue';
import {
  listCustomers,
  listMyTasks,
  listTimeline,
  loadAccount360,
} from '../../src/queries/crm/customers';
import {
  listAccountDuplicates,
  listDuplicates,
  countMergeMoves,
} from '../../src/queries/crm/duplicates';
import { listBoardLeads, listBoardStageLeads } from '../../src/queries/crm/list-board-leads';
import { listLeadAssignees } from '../../src/queries/crm/list-lead-assignees';
import { latestSizing } from '../../src/queries/crm/latest-sizing';
import { countLeads, listLeads } from '../../src/queries/crm/list-leads';
import { listLeadSources, listPipelines } from '../../src/queries/crm/list-pipelines';
import {
  listCodedReferralPartners,
  listCommissionRules,
  listDispositions,
  listPipelineSettings,
  listReferralPartners,
  listScoreRules,
} from '../../src/queries/crm/pipeline-settings';
import { searchLeads } from '../../src/queries/crm/search-leads';
import {
  countFilesAwaitingChecks,
  getFile,
  getStoredFile,
  listCompanyFiles,
} from '../../src/queries/files/file-queries';
import {
  getImportJob,
  listImportJobs,
  listImportRows,
  listImportTemplates,
} from '../../src/queries/imports/import-queries';
import { readEntityBankDetails, readSealedBankDetails } from '../../src/queries/org/bank-details';
import { loadCompanyForPrint } from '../../src/queries/org/company-print';
import { listEntities } from '../../src/queries/org/list-entities';
import { readOutboxHealth } from '../../src/queries/platform/outbox-health';
import { listPriceLists, listPrices } from '../../src/queries/pricing/list-prices';
import { listKitPrices, listPriceChanges } from '../../src/queries/pricing/price-history';
import { listPriceTierOptions } from '../../src/queries/pricing/price-tiers';
import {
  accountQuotes,
  getQuote,
  listQuotes,
  searchQuotes,
} from '../../src/queries/sales/list-quotes';
import { loadQuoteBuilder, previewQuote } from '../../src/queries/sales/quote-builder';
import { loadQuoteForPrint } from '../../src/queries/sales/quote-print';
import { listSavedViews } from '../../src/queries/profile/saved-views';
import { readTaxSettings } from '../../src/queries/tax/tax-settings';

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
const CIPHER = envelopeCipher(localKeyProvider(randomBytes(32).toString('base64')));

/** The moment the quote reads are asked at, so both pools judge validity alike. */
const QUOTES_AT = new Date('2026-10-05T06:00:00Z');

const QUERIES: Record<string, (ctx: RequestContext) => Promise<unknown>> = {
  listUsers: (ctx) => listUsers(ctx, { limit: 20 }),
  listUserSessions: (ctx) => listUserSessions(ctx, { userId: ctx.principal.id }),
  searchPeople: (ctx) => searchPeople(ctx, { q: 'kum' }),
  listRoles: (ctx) => listRoles(ctx),
  getRoleGrants: (ctx) => getRoleGrants(ctx, { roleKey: 'tele_caller_cc' }),
  queryAudit: (ctx) => queryAudit(ctx, { from: WEEK_AGO, to: NOW, limit: 20 }),
  listAuditPeople: (ctx) => listAuditPeople(ctx, { from: WEEK_AGO, to: NOW }),
  listItems: (ctx) => listItems(ctx, { limit: 20 }),
  listItemsWithCost: (ctx) => listItemsWithCost(ctx, 1, { limit: 20 }),
  listKits: (ctx) => listKits(ctx, { limit: 20, includeArchived: true }),
  getItem: (ctx) => getItem(ctx, { itemId: newId() }),
  getKit: (ctx) => getKit(ctx, { kitId: newId() }),
  listBoardLeads: (ctx) => listBoardLeads(ctx, { pipelineKey: PIPELINE }),
  listBoardStageLeads: (ctx) =>
    listBoardStageLeads(ctx, { pipelineKey: PIPELINE, stageId: STAGE, cursor: 'bm8' }),
  listLeadAssignees: (ctx) => listLeadAssignees(ctx, { entityId: 1 }),
  listLeads: (ctx) => listLeads(ctx, { limit: 20 }),
  countLeads: (ctx) => countLeads(ctx),
  listPipelines: (ctx) => listPipelines(ctx),
  listLeadSources: (ctx) => listLeadSources(ctx),
  listPipelineSettings: (ctx) => listPipelineSettings(ctx),
  listDispositions: (ctx) => listDispositions(ctx, { entityId: null, segment: null }),
  listScoreRules: (ctx) => listScoreRules(ctx, { entityId: 1, segment: 'farmer_pumps' }),
  listReferralPartners: (ctx) => listReferralPartners(ctx, { cursor: null }),
  listCommissionRules: (ctx) => listCommissionRules(ctx),
  listCodedReferralPartners: (ctx) => listCodedReferralPartners(ctx),
  searchLeads: (ctx) => searchLeads(ctx, { q: 'ram' }),
  listCustomers: (ctx) => listCustomers(ctx, { limit: 20 }),
  searchCustomers: (ctx) => listCustomers(ctx, { q: 'ram', limit: 20 }),
  searchCustomersByPhone: (ctx) => listCustomers(ctx, { q: '98765', limit: 20 }),
  loadAccount360: (ctx) => loadAccount360(ctx, { accountId: newId(), entityId: 1 }),
  listDuplicates: (ctx) => listDuplicates(ctx, { limit: 20 }),
  listAccountDuplicates: (ctx) => listAccountDuplicates(ctx, { entityId: 1, accountId: newId() }),
  countMergeMoves: (ctx) =>
    countMergeMoves(ctx, { entityId: 1, keptAccountId: newId(), mergedAccountId: newId() }),
  listTimeline: (ctx) => listTimeline(ctx, { entityId: 1, accountId: newId() }),
  listMyTasks: (ctx) => listMyTasks(ctx, { limit: 20 }),
  getImportJob: (ctx) => getImportJob(ctx, { entityId: 1, jobId: newId() }),
  listImportJobs: (ctx) => listImportJobs(ctx, { entityId: 1, limit: 20 }),
  listImportRows: (ctx) => listImportRows(ctx, { entityId: 1, jobId: newId(), limit: 20 }),
  listImportTemplates: (ctx) => listImportTemplates(ctx, { entityId: 1, kind: 'leads' }),
  listEntities: (ctx) => listEntities(ctx),
  readSealedBankDetails: (ctx) => readSealedBankDetails(ctx, 1),
  readEntityBankDetails: (ctx) => readEntityBankDetails(ctx, CIPHER, 1),
  loadCompanyForPrint: (ctx) => loadCompanyForPrint(ctx, 1),
  readOutboxHealth: (ctx) => readOutboxHealth(ctx, { limit: 20 }),
  listPriceLists: (ctx) => listPriceLists(ctx, new Date('2026-09-29T00:00:00Z')),
  listPrices: (ctx) => listPrices(ctx, { priceListId: newId(), limit: 20 }),
  listKitPrices: (ctx) => listKitPrices(ctx, { priceListId: newId(), limit: 20 }),
  listPriceChanges: (ctx) => listPriceChanges(ctx, { itemId: newId() }),
  readTaxSettings: (ctx) => readTaxSettings(ctx),
  listSavedViews: (ctx) => listSavedViews(ctx, { screen: 'leads' }),
  getFile: (ctx) => getFile(ctx, newId()),
  getStoredFile: (ctx) => getStoredFile(ctx, newId()),
  listCompanyFiles: (ctx) => listCompanyFiles(ctx, ['entity_logo', 'letterhead']),
  countFilesAwaitingChecks: (ctx) => countFilesAwaitingChecks(ctx, 10, new Date(NOW)),
  listInbox: (ctx) => listInbox(ctx, { limit: 20 }),
  countInbox: (ctx) => countInbox(ctx),
  loadAgentSettings: (ctx) => loadAgentSettings(ctx, { now: new Date(NOW) }),
  listKnowledgeFiles: (ctx) => listKnowledgeFiles(ctx, {}),
  searchKnowledge: (ctx) => searchKnowledge(ctx, fakeEmbedding('solar pump care')),
  listSizingPumps: (ctx) => listSizingPumps(ctx),
  listCallQueue: (ctx) => listCallQueue(ctx, { limit: 20 }, new Date(NOW)),
  loadCallLead: (ctx) => loadCallLead(ctx, { entityId: 1, opportunityId: newId() }),
  listTeamQueues: (ctx) => listTeamQueues(ctx, {}, new Date(NOW)),
  listQuotes: (ctx) => listQuotes(ctx, { limit: 20 }, QUOTES_AT),
  searchQuotes: (ctx) => searchQuotes(ctx, { q: 'Q/2026', limit: 8 }, QUOTES_AT),
  getQuote: (ctx) => getQuote(ctx, { entityId: 1, quoteId: newId() }, QUOTES_AT),
  loadQuoteBuilder: (ctx) =>
    loadQuoteBuilder(ctx, { entityId: 1, opportunityId: newId() }, QUOTES_AT),
  loadQuoteForPrint: (ctx) => loadQuoteForPrint(ctx, newId()),
  listPriceTierOptions: (ctx) => listPriceTierOptions(ctx),
};

/**
 * Reads the app runs whose names the export check below does not match; each still runs on both
 * pools for every caller.
 */
const OTHER_READS: Record<string, (ctx: RequestContext) => Promise<unknown>> = {
  latestSizing: (ctx) => latestSizing(ctx, { entityId: 1, opportunityId: newId() }),
  dialNumber: (ctx) =>
    dialNumber(ctx, { entityId: 1, opportunityId: newId() }, new Date('2026-10-05T06:00:00Z')),
  accountQuotes: (ctx) => accountQuotes(ctx, newId(), 1, QUOTES_AT),
  previewQuote: (ctx) =>
    previewQuote(
      ctx,
      { entityId: 1, opportunityId: newId(), lines: [{ itemId: newId(), qty: '1' }] },
      QUOTES_AT,
    ),
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
    const covered = Object.keys(QUERIES).filter((name) => !SEARCH_VARIANTS.has(name));
    expect(exported).toEqual(covered.sort());
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

/**
 * The names of the exported read functions: `list…`, `search…`, `get…`, `count…`, `query…`,
 * `read…`, and `load…` but for `loadUserDto`, which runs inside commands on their transaction.
 */
const QUERY_NAMES = /^(list|search|get(?!Command)|count|query|read|load(?!UserDto))[A-Z]/;

/** Further calls of an exported query, with the input that takes another path through it. */
const SEARCH_VARIANTS = new Set(['searchCustomers', 'searchCustomersByPhone']);
