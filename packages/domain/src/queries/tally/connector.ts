import {
  ConnectorHealth,
  DomainError,
  HeldTallySnapshotDto,
  TallyCursorDto,
  type TallyConnectorDto,
  type TallyCursorQuery,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { FieldEnvelopeSchema, type FieldEnvelope } from '../../privacy/field-cipher';
import { readTallyConnector } from '../../commands/tally/connectors';
import { connectorHealth } from '../../tally/sync-rules';

// TC2: the two reads a connector's routes make (docs/06-api.md §3.5), each through its definer as
// the connector's own principal, which reads no table.

type Ctx = Pick<RequestContext, 'tx' | 'entityIds'>;

/** A company served by a connector: the group's company and the name Tally gives it. */
export interface TallyConnectorCompany {
  entityId: number;
  entityCode: string;
  tallyCompany: string;
}

/** What the routes need to verify a connector's signature and scope its request. */
export interface TallyConnectorAuth {
  /** The current key sealed and, during a rotation, the next: opened with `openConnectorKeys()`. */
  sealedKeys: FieldEnvelope[];
  companies: TallyConnectorCompany[];
}

interface AuthRow {
  key_sealed: unknown;
  next_key_sealed: unknown;
  entity_id: number | null;
  entity_code: string | null;
  tally_company: string | null;
}

/**
 * The live connector the request's header names, asked as that connector before its signature is
 * checked; undefined for an unknown or revoked one. The definer answers only the caller's own row.
 */
export async function findTallyConnector(
  ctx: Ctx,
  connectorId: string,
): Promise<TallyConnectorAuth | undefined> {
  const rows = (await ctx.tx.execute(sql`
    select key_sealed, next_key_sealed, entity_id, entity_code, tally_company
      from app.tally_connector_auth(${connectorId}::uuid)`)) as unknown as AuthRow[];
  const [first] = rows;
  if (first === undefined) return undefined;
  const companies: TallyConnectorCompany[] = [];
  for (const row of rows) {
    if (row.entity_id === null || row.entity_code === null || row.tally_company === null) continue;
    companies.push({
      entityId: row.entity_id,
      entityCode: row.entity_code,
      tallyCompany: row.tally_company,
    });
  }
  return {
    sealedKeys: [
      FieldEnvelopeSchema.parse(first.key_sealed),
      ...(first.next_key_sealed === null ? [] : [FieldEnvelopeSchema.parse(first.next_key_sealed)]),
    ],
    companies,
  };
}

/** `GET /connector/tally/cursor`: the AlterID the BOS has accepted for a company, zero before any. */
export async function readTallyCursor(ctx: Ctx, query: TallyCursorQuery): Promise<TallyCursorDto> {
  if (!ctx.entityIds.includes(query.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope');
  }
  const [row] = (await ctx.tx.execute(sql`
    select last_alter_id, updated_at
      from app.tally_cursor(${query.entityId}::smallint, ${query.company}::text)`)) as unknown as {
    last_alter_id: string | number;
    updated_at: string | Date;
  }[];
  return TallyCursorDto.parse({
    company: query.company,
    lastAlterId: row === undefined ? 0 : Number(row.last_alter_id),
    updatedAt: row === undefined ? null : new Date(row.updated_at).toISOString(),
  });
}

/** A live connector's heartbeat and held rows, with when each alert last went out. */
export interface TallyConnectorAlertFacts {
  connectorId: string;
  lastHeartbeatAt: Date | undefined;
  silenceAlertedAt: Date | undefined;
  heldRows: number;
  heldSince: Date | undefined;
  heldAlertedAt: Date | undefined;
}

const dateOrUndefined = (value: string | Date | null): Date | undefined =>
  value === null ? undefined : new Date(value);

/**
 * The hourly jobs check's read (`system:workers`, `platform.jobs.check`): every live connector's
 * last heartbeat and held rows, through `app.tally_connector_alerts()`; nothing of any company.
 */
export async function readTallyConnectorAlerts(ctx: Ctx): Promise<TallyConnectorAlertFacts[]> {
  const rows = (await ctx.tx.execute(sql`
    select connector_id, last_heartbeat_at, silence_alerted_at, held_rows, held_since,
           held_alerted_at
      from app.tally_connector_alerts()`)) as unknown as {
    connector_id: string;
    last_heartbeat_at: string | Date | null;
    silence_alerted_at: string | Date | null;
    held_rows: number | null;
    held_since: string | Date | null;
    held_alerted_at: string | Date | null;
  }[];
  return rows.map((r) => ({
    connectorId: r.connector_id,
    lastHeartbeatAt: dateOrUndefined(r.last_heartbeat_at),
    silenceAlertedAt: dateOrUndefined(r.silence_alerted_at),
    heldRows: r.held_rows ?? 0,
    heldSince: dateOrUndefined(r.held_since),
    heldAlertedAt: dateOrUndefined(r.held_alerted_at),
  }));
}

/** Whether a stretch of held rows has had no alert yet. */
export function shouldAlertHeldRows(facts: Pick<TallyConnectorAlertFacts, 'heldSince' | 'heldAlertedAt'>): boolean {
  return (
    facts.heldSince !== undefined &&
    (facts.heldAlertedAt === undefined || facts.heldAlertedAt < facts.heldSince)
  );
}

/**
 * Integration health's Tally rows (`admin.integrations.write`), under the viewer's own policies:
 * each live connector's mapped companies of the request with the connector's last heartbeat,
 * version, outbox depth and held rows, the company's cursor and Tally's own last AlterID.
 */
export async function readTallyConnectorHealth(ctx: Ctx, now: Date): Promise<ConnectorHealth[]> {
  const rows = (await ctx.tx.execute(sql`
    select c.id as connector_id, c.name, c.connector_version, c.last_heartbeat_at, c.queue_depth,
           c.held_rows, m.entity_id, m.tally_company, m.reachable, m.tally_last_alter_id,
           m.problem, cur.last_alter_id, cur.updated_at as last_batch_at
      from tally_connectors c
      join tally_connector_companies m on m.connector_id = c.id
      left join tally_cursors cur on cur.entity_id = m.entity_id
                                 and cur.tally_company = m.tally_company
     where c.revoked_at is null
     order by c.name, m.entity_id, m.tally_company`)) as unknown as {
    connector_id: string;
    name: string;
    connector_version: string | null;
    last_heartbeat_at: string | Date | null;
    queue_depth: number | null;
    held_rows: number | null;
    entity_id: number;
    tally_company: string;
    reachable: boolean | null;
    tally_last_alter_id: string | number | null;
    problem: string | null;
    last_alter_id: string | number | null;
    last_batch_at: string | Date | null;
  }[];
  return rows.map((r) => {
    const heartbeat = dateOrUndefined(r.last_heartbeat_at);
    const health = connectorHealth(heartbeat, now);
    const cursor = Number(r.last_alter_id ?? 0);
    return ConnectorHealth.parse({
      connectorId: r.connector_id,
      name: r.name,
      entityId: r.entity_id,
      company: r.tally_company,
      connectorVersion: r.connector_version,
      updateAvailable: false,
      lastHeartbeatAt: heartbeat?.toISOString() ?? null,
      lastBatchAt: dateOrUndefined(r.last_batch_at)?.toISOString() ?? null,
      queueDepth: r.queue_depth ?? 0,
      heldRows: r.held_rows ?? 0,
      health,
      silent: health === 'silent',
      reachable: r.reachable,
      lag:
        r.tally_last_alter_id === null ? null : Math.max(0, Number(r.tally_last_alter_id) - cursor),
      problem: r.problem,
    });
  });
}

/**
 * Admin › Integrations › Tally (`admin.integrations.write`): every connector, live ones first, with
 * the companies of the request mapped to it, under the viewer's own policies.
 */
export async function listTallyConnectors(ctx: Ctx): Promise<TallyConnectorDto[]> {
  const ids = (await ctx.tx.execute(sql`
    select id from tally_connectors
     order by revoked_at is not null, created_at, id
     limit 50`)) as unknown as { id: string }[];
  const out: TallyConnectorDto[] = [];
  for (const { id } of ids) out.push(await readTallyConnector(ctx, id));
  return out;
}

/**
 * Tally checks (`finance.read` reads them; Accounts confirm with `finance.recon.write`): the
 * snapshots of the request's companies held over their limits, oldest first. Served by
 * `tally_snapshots_held_idx`.
 */
export async function listHeldTallySnapshots(ctx: Ctx): Promise<HeldTallySnapshotDto[]> {
  const rows = (await ctx.tx.execute(sql`
    select id, entity_id, tally_company, as_of, cardinality(held_guids) as would_remove, live,
           created_at
      from tally_snapshots
     where state = 'held' and entity_id = any (${`{${ctx.entityIds.join(',')}}`}::smallint[])
     order by created_at, id
     limit 100`)) as unknown as {
    id: string;
    entity_id: number;
    tally_company: string;
    as_of: string | Date;
    would_remove: number;
    live: number;
    created_at: string | Date;
  }[];
  return rows.map((r) =>
    HeldTallySnapshotDto.parse({
      snapshotId: r.id,
      entityId: r.entity_id,
      tallyCompany: r.tally_company,
      asOf: new Date(r.as_of).toISOString(),
      wouldRemove: Number(r.would_remove),
      live: r.live,
      receivedAt: new Date(r.created_at).toISOString(),
    }),
  );
}
