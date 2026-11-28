import type { FeatureFlagKey } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';

/** One row of `feature_flags` as the resolution reads it. */
export interface FeatureFlagRow {
  key: string;
  entityId: number | null;
  enabled: boolean;
}

/**
 * The flags of a person working in `entityIds` (docs/03-roadmap-appendix/phase4.md §6.4): in each
 * company a flag is that company's own row, else the group's row, else off; and the person has it
 * on when any of their companies does, so a feature rolled out to one company reaches everyone
 * working there. Pure, so the server and `GET /me` resolve alike.
 */
export function resolveFeatureFlags(
  rows: readonly FeatureFlagRow[],
  entityIds: readonly number[],
): Record<FeatureFlagKey, boolean> {
  const group = new Map<string, boolean>();
  const byCompany = new Map<string, boolean>();
  for (const row of rows) {
    if (row.entityId === null) group.set(row.key, row.enabled);
    else byCompany.set(`${row.key}:${String(row.entityId)}`, row.enabled);
  }
  const keys = [...new Set(rows.map((r) => r.key))].sort();
  const flags: Record<string, boolean> = {};
  for (const key of keys) {
    flags[key] = entityIds.some(
      (entityId) => byCompany.get(`${key}:${String(entityId)}`) ?? group.get(key) ?? false,
    );
  }
  return flags;
}

/**
 * The flags as they apply to the request's principal, read under its own policies: the group's
 * rows and those of the request's companies. A dozen rows at most, so no list limit.
 */
export async function readFeatureFlags(
  ctx: Pick<RequestContext, 'tx' | 'entityIds'>,
): Promise<Record<FeatureFlagKey, boolean>> {
  const f = schema.featureFlags;
  const rows = await ctx.tx
    .select({ key: f.key, entityId: f.entityId, enabled: f.enabled })
    .from(f);
  return resolveFeatureFlags(rows, ctx.entityIds);
}
