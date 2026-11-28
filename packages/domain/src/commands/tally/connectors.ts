import {
  DomainError,
  MapTallyCompanyInput,
  newId,
  RegisterTallyConnectorInput,
  RotateTallyConnectorInput,
  TallyConnectorDto,
  TallyConnectorIdInput,
  UnmapTallyCompanyInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { sealConnectorKey } from '../../tally/connector-key';
import { assertEntityInScope } from '../imports/shared';

// TC2 Admin › Integrations › Tally (docs/03-roadmap-appendix/phase5.md §6.3): an Executive
// (`admin.integrations.write`, a person) registers a connector as a principal of its own, maps its
// Tally companies, rotates its key and revokes it, through the definers of the TC2 migration. The
// action makes each key (`newConnectorKey()`) and shows it once; the command seals it with the
// field cipher before it is stored, and no audit row, log or answer holds it.

const c = schema.tallyConnectors;
const m = schema.tallyConnectorCompanies;
const cur = schema.tallyCursors;

const CONSTRAINT_REASONS = {
  tally_connector_companies_entity_unique: 'tally_company_already_mapped',
  tally_connector_companies_connector_id_tally_company_pk: 'tally_company_already_mapped',
  tally_connector_revoked: 'tally_connector_revoked',
  tally_connector_no_next_key: 'tally_connector_no_next_key',
} as const;

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** A connector as the Executive sees it, with the companies of the request mapped to it. */
export async function readTallyConnector(
  ctx: Pick<CommandContext, 'tx'>,
  connectorId: string,
): Promise<TallyConnectorDto> {
  const [row] = await ctx.tx
    .select({
      id: c.id,
      name: c.name,
      keyHint: c.keyHint,
      nextKeyHint: c.nextKeyHint,
      connectorVersion: c.connectorVersion,
      tallyVersion: c.tallyVersion,
      queueDepth: c.queueDepth,
      heldRows: c.heldRows,
      lastHeartbeatAt: c.lastHeartbeatAt,
      revokedAt: c.revokedAt,
      createdAt: c.createdAt,
    })
    .from(c)
    .where(eq(c.id, connectorId))
    .limit(1);
  if (!row) throw new DomainError('not_found', 'no such connector');
  const companies = await ctx.tx
    .select({
      tallyCompany: m.tallyCompany,
      entityId: m.entityId,
      reachable: m.reachable,
      lastAlterId: sql<number>`coalesce(${cur.lastAlterId}, 0)`.mapWith(Number),
      tallyLastAlterId: m.tallyLastAlterId,
      problem: m.problem,
      reportedAt: m.reportedAt,
    })
    .from(m)
    .leftJoin(cur, and(eq(cur.entityId, m.entityId), eq(cur.tallyCompany, m.tallyCompany)))
    .where(eq(m.connectorId, connectorId))
    .orderBy(asc(m.entityId), asc(m.tallyCompany));
  return TallyConnectorDto.parse({
    ...row,
    lastHeartbeatAt: iso(row.lastHeartbeatAt),
    revokedAt: iso(row.revokedAt),
    createdAt: row.createdAt.toISOString(),
    companies: companies.map((co) => ({ ...co, reportedAt: iso(co.reportedAt) })),
  });
}

/** The field cipher of the call; a runtime without one cannot keep a key. */
function cipherOf(ctx: CommandContext) {
  if (ctx.fieldCipher === undefined) {
    throw new DomainError('integration_unavailable', 'no field cipher on this runtime');
  }
  return ctx.fieldCipher;
}

/** `tally.connector.register`: a new connector and its first key, sealed. */
export const registerTallyConnector = defineCommand({
  name: 'tally.connector.register',
  permission: 'admin.integrations.write',
  minScope: 'all',
  peopleOnly: true,
  input: RegisterTallyConnectorInput,
  output: TallyConnectorDto,
  auditFields: ['name', 'keyHint'],
  unmaskedFields: [
    // The connector's key, sealed whole; masking would break it.
    'key',
  ],
  // The key never reaches the audit row: only its last four characters.
  auditInput: (input) => ({ name: input.name, keyHint: input.key.slice(-4) }),
  constraintReasons: CONSTRAINT_REASONS,
  async handler(ctx, input) {
    const id = newId();
    // Sealed before any row is written: the key service is a network call.
    const sealed = await sealConnectorKey(cipherOf(ctx), id, input.key);
    const keyHint = input.key.slice(-4);
    await ctx.tx.execute(sql`
      select app.tally_connector_register(${id}::uuid, ${input.name}::text,
                                          ${JSON.stringify(sealed)}::jsonb, ${keyHint}::text)`);
    ctx.audit({
      aggregateType: 'tally_connector',
      aggregateId: id,
      entityId: null,
      after: { name: input.name, keyHint },
    });
    return readTallyConnector(ctx, id);
  },
});

/** `tally.connector.map`: a Tally company's vouchers belong to a company of the request. */
export const mapTallyCompany = defineCommand({
  name: 'tally.connector.map',
  permission: 'admin.integrations.write',
  minScope: 'all',
  peopleOnly: true,
  input: MapTallyCompanyInput,
  output: TallyConnectorDto,
  auditFields: ['tallyCompany'],
  constraintReasons: CONSTRAINT_REASONS,
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    await ctx.tx.execute(sql`
      select app.tally_connector_map(${input.connectorId}::uuid, ${input.tallyCompany}::text,
                                     ${input.entityId}::smallint)`);
    ctx.audit({
      aggregateType: 'tally_connector',
      aggregateId: input.connectorId,
      entityId: input.entityId,
      after: { tallyCompany: input.tallyCompany },
    });
    return readTallyConnector(ctx, input.connectorId);
  },
});

/**
 * `tally.connector.unmap`: one Tally company stops being served by the connector; the group
 * company's other Tally companies (one per financial year, say) stay linked.
 */
export const unmapTallyCompany = defineCommand({
  name: 'tally.connector.unmap',
  permission: 'admin.integrations.write',
  minScope: 'all',
  peopleOnly: true,
  input: UnmapTallyCompanyInput,
  output: TallyConnectorDto,
  auditFields: ['tallyCompany'],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const before = await readTallyConnector(ctx, input.connectorId);
    const mapped = before.companies.some(
      (co) => co.entityId === input.entityId && co.tallyCompany === input.tallyCompany,
    );
    if (!mapped) {
      throw new DomainError('not_found', 'the company is not mapped to the connector', {
        reason: 'tally_company_not_mapped',
      });
    }
    await ctx.tx.execute(sql`
      select app.tally_connector_unmap(${input.connectorId}::uuid, ${input.entityId}::smallint,
                                       ${input.tallyCompany}::text)`);
    ctx.audit({
      aggregateType: 'tally_connector',
      aggregateId: input.connectorId,
      entityId: input.entityId,
      before: { tallyCompany: input.tallyCompany },
      after: { tallyCompany: null },
    });
    return readTallyConnector(ctx, input.connectorId);
  },
});

/** `tally.connector.rotate`: a new key, sealed, valid beside the current one until that is retired. */
export const rotateTallyConnectorKey = defineCommand({
  name: 'tally.connector.rotate',
  permission: 'admin.integrations.write',
  minScope: 'all',
  peopleOnly: true,
  input: RotateTallyConnectorInput,
  output: TallyConnectorDto,
  auditFields: ['nextKeyHint'],
  unmaskedFields: [
    // The connector's key, sealed whole; masking would break it.
    'key',
  ],
  auditInput: (input) => ({ connectorId: input.connectorId, keyHint: input.key.slice(-4) }),
  constraintReasons: CONSTRAINT_REASONS,
  async handler(ctx, input) {
    const sealed = await sealConnectorKey(cipherOf(ctx), input.connectorId, input.key);
    const before = await readTallyConnector(ctx, input.connectorId);
    const keyHint = input.key.slice(-4);
    await ctx.tx.execute(sql`
      select app.tally_connector_rotate(${input.connectorId}::uuid,
                                        ${JSON.stringify(sealed)}::jsonb, ${keyHint}::text)`);
    ctx.audit({
      aggregateType: 'tally_connector',
      aggregateId: input.connectorId,
      entityId: null,
      before: { nextKeyHint: before.nextKeyHint },
      after: { nextKeyHint: keyHint },
    });
    return readTallyConnector(ctx, input.connectorId);
  },
});

/** `tally.connector.retire_key`: the new key becomes the only one; the old stops working. */
export const retireTallyConnectorKey = defineCommand({
  name: 'tally.connector.retire_key',
  permission: 'admin.integrations.write',
  minScope: 'all',
  peopleOnly: true,
  input: TallyConnectorIdInput,
  output: TallyConnectorDto,
  auditFields: ['keyHint', 'nextKeyHint'],
  constraintReasons: CONSTRAINT_REASONS,
  async handler(ctx, input) {
    const before = await readTallyConnector(ctx, input.connectorId);
    await ctx.tx.execute(sql`select app.tally_connector_retire_key(${input.connectorId}::uuid)`);
    const after = await readTallyConnector(ctx, input.connectorId);
    ctx.audit({
      aggregateType: 'tally_connector',
      aggregateId: input.connectorId,
      entityId: null,
      before: { keyHint: before.keyHint, nextKeyHint: before.nextKeyHint },
      after: { keyHint: after.keyHint, nextKeyHint: null },
    });
    return after;
  },
});

/** `tally.connector.revoke`: the connector's keys stop working and its companies are freed. */
export const revokeTallyConnector = defineCommand({
  name: 'tally.connector.revoke',
  permission: 'admin.integrations.write',
  minScope: 'all',
  peopleOnly: true,
  input: TallyConnectorIdInput,
  output: TallyConnectorDto,
  auditFields: ['revokedAt'],
  constraintReasons: CONSTRAINT_REASONS,
  async handler(ctx, input) {
    await ctx.tx.execute(sql`select app.tally_connector_revoke(${input.connectorId}::uuid)`);
    const after = await readTallyConnector(ctx, input.connectorId);
    ctx.audit({
      aggregateType: 'tally_connector',
      aggregateId: input.connectorId,
      entityId: null,
      before: { revokedAt: null },
      after: { revokedAt: after.revokedAt },
    });
    return after;
  },
});
