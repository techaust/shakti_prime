/**
 * The four selling entities. GSTINs, UPI ids and letterheads are client data entered in
 * Admin › Entities on the real environments, never committed (AGENTS.md §6).
 */
export const ENTITY_SEED = [
  { id: 1, code: 'SS', legalName: 'Shakti Supreme', brandName: 'Shakti Supreme', stateCode: '08' },
  {
    id: 2,
    code: 'SMP',
    legalName: 'Shakti Motor Pumps',
    brandName: 'Shakti Motor Pumps',
    stateCode: '08',
  },
  { id: 3, code: 'ASH', legalName: 'Agro Solar Hub', brandName: 'Agro Solar Hub', stateCode: '08' },
  { id: 4, code: 'RCREF', legalName: 'RCREF', brandName: 'RCREF', stateCode: '08' },
] as const;

export const ALL_ENTITY_IDS: readonly number[] = ENTITY_SEED.map((e) => e.id);
