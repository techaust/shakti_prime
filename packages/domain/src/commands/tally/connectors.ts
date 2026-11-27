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
import { asc, eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { assertEntityInScope } from '../imports/shared';

// TC2 Admin › Integrations › Tally (docs/03-roadmap-appendix/phase5.md §6.3): an Executive
// (`admin.integrations.write`, a person) registers a connector as a principal of its own, maps its
// Tally companies, rotates its key and revokes it, through the definers of the TC2 migration. The
// action makes each key (`newConnectorKey()`) and shows it once; a command receives only the key's
// SHA-256 and last four characters, and no audit row holds the hash.

const c = schema.tallyConnectors;
const m = schema.tallyConnectorCompanies;

const CONSTRAINT_REASONS = {
  tally_connector_companies_entity_unique: 'tally_company_already_mapped',
  tally_connector_companies_connector_id_tally_company_pk: 'tally_company_already_mapped',
  tally_connector_revoked: 'tally_connector_revoked',
  tally_connector_no_next_key: 'tally_connector_no_next_key',
} as const;

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
      reportedAlterId: m.reportedAlterId,
      reportedAt: m.reportedAt,
    })
    .from(m)
    .where(eq(m.connectorId, connectorId))
    .orderBy(asc(m.entityId));
  return TallyConnectorDto.parse({
    ...row,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    companies: companies.map((co) => ({
      ...co,
      reportedAt: co.reportedAt?.toISOString() ?? null,
    })),
  });
}

/** `tally.connector.register`: a new connector and its first key, by the key's hash. */
export const registerTallyConnector = defineCommand({
  name: 'tally.connector.register',
  permission: 'admin.integrations.write',
  minScope: 'all',
  peopleOnly: true,
  input: RegisterTallyConnectorInput,
  output: TallyConnectorDto,
  auditFields: ['name', 'keyHint'],
  unmaskedFields: [
    // A SHA-256 in hexadecimal, stored whole and matched whole.
    'keyHash',
  ],
  auditInput: (input) => ({ name: input.name, keyHint: input.keyHint }),
  constraintReasons: CONSTRAINT_REASONS,
  async handler(ctx, input) {
    const id = newId();
    await ctx.tx.execute(sql`
      select app.tally_connector_register(${id}::uuid, ${input.name}::text,
                                          ${input.keyHash}::text, ${input.keyHint}::text)`);
    ctx.audit({
      aggregateType: 'tally_connector',
      aggregateId: id,
      entityId: null,
      after: { name: input.name, keyHint: input.keyHint },
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

/** `tally.connector.unmap`: the company stops being served by the connector. */
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
    const mapped = before.companies.find((co) => co.entityId === input.entityId);
    if (mapped === undefined) {
      throw new DomainError('not_found', 'the company is not mapped to the connector', {
        reason: 'tally_company_not_mapped',
      });
    }
    await ctx.tx.execute(sql`
      select app.tally_connector_unmap(${input.connectorId}::uuid, ${input.entityId}::smallint)`);
    ctx.audit({
      aggregateType: 'tally_connector',
      aggregateId: input.connectorId,
      entityId: input.entityId,
      before: { tallyCompany: mapped.tallyCompany },
      after: { tallyCompany: null },
    });
    return readTallyConnector(ctx, input.connectorId);
  },
});

/** `tally.connector.rotate`: a new key, valid beside the current one until that is retired. */
export const rotateTallyConnectorKey = defineCommand({
  name: 'tally.connector.rotate',
  permission: 'admin.integrations.write',
  minScope: 'all',
  peopleOnly: true,
  input: RotateTallyConnectorInput,
  output: TallyConnectorDto,
  auditFields: ['nextKeyHint'],
  unmaskedFields: [
    // A SHA-256 in hexadecimal, stored whole and matched whole.
    'keyHash',
  ],
  auditInput: (input) => ({ connectorId: input.connectorId, keyHint: input.keyHint }),
  constraintReasons: CONSTRAINT_REASONS,
  async handler(ctx, input) {
    const before = await readTallyConnector(ctx, input.connectorId);
    await ctx.tx.execute(sql`
      select app.tally_connector_rotate(${input.connectorId}::uuid, ${input.keyHash}::text,
                                        ${input.keyHint}::text)`);
    ctx.audit({
      aggregateType: 'tally_connector',
      aggregateId: input.connectorId,
      entityId: null,
      before: { nextKeyHint: before.nextKeyHint },
      after: { nextKeyHint: input.keyHint },
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
