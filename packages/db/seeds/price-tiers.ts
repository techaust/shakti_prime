import type { PriceTierCode } from '@shakti/contracts';

/** The three price tiers of docs/BLUEPRINT.md §8.3. Executives add more from Admin. */
export const PRICE_TIER_SEED: readonly {
  id: string;
  code: PriceTierCode;
  name: string;
  nameHi: string;
}[] = [
  {
    id: '01990000-0000-7000-8000-000000000701',
    code: 'retail',
    name: 'Retail price',
    nameHi: 'रिटेल दाम',
  },
  {
    id: '01990000-0000-7000-8000-000000000702',
    code: 'dealer',
    name: 'Dealer price',
    nameHi: 'डीलर दाम',
  },
  {
    id: '01990000-0000-7000-8000-000000000703',
    code: 'commercial',
    name: 'Commercial price',
    nameHi: 'कमर्शियल दाम',
  },
];

export function tierId(code: PriceTierCode): string {
  const row = PRICE_TIER_SEED.find((t) => t.code === code);
  if (!row) throw new Error(`no seeded price tier ${code}`);
  return row.id;
}
