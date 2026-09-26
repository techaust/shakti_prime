import type { Segment, StageKind } from '@shakti/contracts';

/**
 * The four pipelines (docs/BLUEPRINT.md §8.1) with the six stage names that are already product
 * vocabulary (DESIGN.md §2.3). Executives reshape stages from Admin; ids are fixed for idempotent seeds.
 */
export const PIPELINE_SEED: readonly {
  id: string;
  key: string;
  segment: Segment;
  name: string;
  nameHi: string;
}[] = [
  {
    id: '01990000-0000-7000-8000-000000000401',
    key: 'farmer_pumps',
    segment: 'farmer_pumps',
    name: 'Farmer Pumps',
    nameHi: 'किसान पंप',
  },
  {
    id: '01990000-0000-7000-8000-000000000402',
    key: 'residential_rooftop',
    segment: 'residential_rooftop',
    name: 'Residential Rooftop',
    nameHi: 'घरेलू रूफटॉप',
  },
  {
    id: '01990000-0000-7000-8000-000000000403',
    key: 'commercial_epc',
    segment: 'commercial_epc',
    name: 'Commercial EPC',
    nameHi: 'कमर्शियल ईपीसी',
  },
  {
    id: '01990000-0000-7000-8000-000000000404',
    key: 'dealer_wholesale',
    segment: 'dealer_wholesale',
    name: 'Dealer and Wholesale',
    nameHi: 'डीलर और होलसेल',
  },
];

export const STAGE_TEMPLATE: readonly {
  key: string;
  name: string;
  nameHi: string;
  kind: StageKind;
}[] = [
  { key: 'new', name: 'New', nameHi: 'नई', kind: 'open' },
  { key: 'contacted', name: 'Contacted', nameHi: 'बात हुई', kind: 'open' },
  { key: 'qualified', name: 'Qualified', nameHi: 'योग्य', kind: 'open' },
  { key: 'quoted', name: 'Quoted', nameHi: 'कोटेशन भेजा', kind: 'open' },
  { key: 'won', name: 'Won', nameHi: 'सौदा हुआ', kind: 'won' },
  { key: 'lost', name: 'Lost', nameHi: 'सौदा नहीं हुआ', kind: 'lost' },
];

/** Deterministic stage id: pipeline index (1-4) and stage position (1-6). */
export function stageId(pipelineIndex: number, position: number): string {
  return `01990000-0000-7000-8000-0000000005${pipelineIndex}${position}`;
}

export const STAGE_SEED = PIPELINE_SEED.flatMap((pipeline, p) =>
  STAGE_TEMPLATE.map((stage, s) => ({
    id: stageId(p + 1, s + 1),
    pipelineId: pipeline.id,
    key: stage.key,
    name: stage.name,
    nameHi: stage.nameHi,
    position: s + 1,
    kind: stage.kind,
  })),
);
