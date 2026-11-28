import type { FeatureFlagKey } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { listEntities } from '../org/list-entities';
import { readFeatureFlags } from './feature-flags';

/**
 * What `GET /me` reads from the database for the field app (docs/06-api.md §3.1), under the
 * caller's own policies: the short code of each company they work in and the feature flags that
 * apply to them. The person, their roles and grants come from principal resolution.
 */
export async function fieldAppProfile(ctx: Pick<RequestContext, 'tx' | 'entityIds'>): Promise<{
  entityCodes: ReadonlyMap<number, string>;
  featureFlags: Record<FeatureFlagKey, boolean>;
}> {
  const entities = await listEntities(ctx);
  const featureFlags = await readFeatureFlags(ctx);
  return { entityCodes: new Map(entities.map((e) => [e.id, e.code])), featureFlags };
}
