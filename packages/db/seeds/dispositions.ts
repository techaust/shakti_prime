import { WORKSHOP_DISPOSITIONS } from '@shakti/contracts';

/**
 * The group's call outcomes (CALL-1), from the workshop default in `@shakti/contracts`. The seed
 * writes them only while the group has no outcomes of its own, so a list an Executive has set is
 * never overwritten, and the archived rows it replaced are never brought back.
 */
export const DISPOSITION_SEED = WORKSHOP_DISPOSITIONS.map((d, i) => ({
  id: `01990000-0000-7000-8000-00000000070${d.key.toString()}`,
  entityId: null,
  segment: null,
  key: d.key,
  code: d.code,
  label: d.label,
  nextAction: d.nextAction,
  position: i + 1,
}));
