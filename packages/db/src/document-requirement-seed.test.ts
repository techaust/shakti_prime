import { IdSchema } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_REQUIREMENT_SEED, requirementSeedId } from '../seeds/document-requirements';

// J3's seeded requirements: each id is made from the row's keys, so adding a requirement anywhere
// in the workshop's list never gives it an id a company already holds for another requirement.
describe('the document requirement seed', () => {
  it('gives each row a valid id of its own, from its keys alone', () => {
    const ids = DOCUMENT_REQUIREMENT_SEED.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of DOCUMENT_REQUIREMENT_SEED) {
      expect(IdSchema.safeParse(r.id).success).toBe(true);
      expect(r.id).toBe(requirementSeedId(r.entityId, r.flow, r.stepKey, r.requirementKey));
    }
  });

  it('keeps a row’s id when the list around it changes', () => {
    expect(requirementSeedId(1, 'standard', 'survey', 'electricity_bill')).toBe(
      requirementSeedId(1, 'standard', 'survey', 'electricity_bill'),
    );
    expect(requirementSeedId(1, 'standard', 'survey', 'electricity_bill')).not.toBe(
      requirementSeedId(2, 'standard', 'survey', 'electricity_bill'),
    );
  });
});
