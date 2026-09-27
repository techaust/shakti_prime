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
}[] = [
  {
    id: '01990000-0000-7000-8000-000000000401',
    key: 'farmer_pumps',
    segment: 'farmer_pumps',
    name: 'Farmer Pumps',
  },
  {
    id: '01990000-0000-7000-8000-000000000402',
    key: 'residential_rooftop',
    segment: 'residential_rooftop',
    name: 'Residential Rooftop',
  },
  {
    id: '01990000-0000-7000-8000-000000000403',
    key: 'commercial_epc',
    segment: 'commercial_epc',
    name: 'Commercial EPC',
  },
  {
    id: '01990000-0000-7000-8000-000000000404',
    key: 'dealer_wholesale',
    segment: 'dealer_wholesale',
    name: 'Dealer and Wholesale',
  },
];

export const STAGE_TEMPLATE: readonly {
  key: string;
  name: string;
  kind: StageKind;
}[] = [
  { key: 'new', name: 'New', kind: 'open' },
  { key: 'contacted', name: 'Contacted', kind: 'open' },
  { key: 'qualified', name: 'Qualified', kind: 'open' },
  { key: 'quoted', name: 'Quoted', kind: 'open' },
  { key: 'won', name: 'Won', kind: 'won' },
  { key: 'lost', name: 'Lost', kind: 'lost' },
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
    position: s + 1,
    kind: stage.kind,
  })),
);
