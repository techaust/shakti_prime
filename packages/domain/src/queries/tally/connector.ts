import { DomainError, TallyCursorDto, type TallyCursorQuery } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { FieldEnvelopeSchema, type FieldEnvelope } from '../../privacy/field-cipher';

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
