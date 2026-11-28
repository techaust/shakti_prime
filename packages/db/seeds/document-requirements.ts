import { WORKSHOP_DOCUMENT_REQUIREMENTS } from '@shakti/contracts';
import { createHash } from 'node:crypto';
import { ALL_ENTITY_IDS } from './entities';

/**
 * A requirement's seed id, made from its four keys, so a requirement added anywhere in the list
 * gets an id of its own and a company seeded before keeps the ids it has.
 */
export function requirementSeedId(entityId: number, flow: string, stepKey: string, key: string) {
  const h = createHash('sha256')
    .update(`${String(entityId)}/${flow}/${stepKey}/${key}`)
    .digest('hex');
  return `01990000-0000-7${h.slice(0, 3)}-8${h.slice(3, 6)}-${h.slice(6, 18)}`;
}

/**
 * J3: the workshop's document requirements (PROJ-1, docs/03-roadmap-appendix/phase4.md §10) for
 * every company. The seed adds a requirement a company lacks and never changes one: its keys are
 * the code's, and whether it is mandatory, the kinds it takes, its place and whether it is on are
 * an Executive's (Settings › Document requirements).
 */
export const DOCUMENT_REQUIREMENT_SEED = ALL_ENTITY_IDS.flatMap((entityId) =>
  WORKSHOP_DOCUMENT_REQUIREMENTS.map((r) => ({
    id: requirementSeedId(entityId, r.flow, r.stepKey, r.requirementKey),
    entityId,
    flow: r.flow,
    stepKey: r.stepKey,
    requirementKey: r.requirementKey,
    mandatory: r.mandatory,
    acceptedKinds: [...r.acceptedKinds],
    position: r.position,
    active: true,
  })),
);
