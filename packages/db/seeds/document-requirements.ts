import { WORKSHOP_DOCUMENT_REQUIREMENTS } from '@shakti/contracts';
import { ALL_ENTITY_IDS } from './entities';

/**
 * J3: the workshop's document requirements (PROJ-1, docs/03-roadmap-appendix/phase4.md §10) for
 * every company. The seed adds a requirement a company lacks and never changes one: its keys are
 * the code's, and whether it is mandatory, the kinds it takes, its place and whether it is on are
 * an Executive's (Settings › Document requirements).
 */
export const DOCUMENT_REQUIREMENT_SEED = ALL_ENTITY_IDS.flatMap((entityId) =>
  WORKSHOP_DOCUMENT_REQUIREMENTS.map((r, i) => ({
    id: `01990000-0000-7000-8000-00000d${entityId.toString(16).padStart(2, '0')}${i
      .toString(16)
      .padStart(4, '0')}`,
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
