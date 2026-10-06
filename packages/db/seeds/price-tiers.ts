import type { PriceTierCode } from '@shakti/contracts';

/** The three price tiers of docs/01-blueprint.md §8.3. Executives add more from Admin. */
export const PRICE_TIER_SEED: readonly {
  id: string;
  code: PriceTierCode;
  name: string;
}[] = [
  {
    id: '01990000-0000-7000-8000-000000000701',
    code: 'retail',
    name: 'Retail price',
  },
  {
    id: '01990000-0000-7000-8000-000000000702',
    code: 'dealer',
    name: 'Dealer price',
  },
  {
    id: '01990000-0000-7000-8000-000000000703',
    code: 'commercial',
    name: 'Commercial price',
  },
];

export function tierId(code: PriceTierCode): string {
  const row = PRICE_TIER_SEED.find((t) => t.code === code);
  if (!row) throw new Error(`no seeded price tier ${code}`);
  return row.id;
}
