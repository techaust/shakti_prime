import type { AccountType } from '@shakti/contracts';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';

/** What a change of a customer's type needs beyond `crm.account.write` (DOM-1). */
export interface AccountTypeChangeNeeds {
  /**
   * The customer becomes or stops being a dealer, which decides whether the dealer credit check
   * runs and whether an order may skip the quote (SAL-07, SAL-04): `sales.credit.write` at
   * company scope (Accounts, the Executive). The database refuses it too (`accounts_type_guard`).
   */
  credit: boolean;
  /**
   * A customer with no tier of their own is priced from the workshop map by type (PRICE-1), so a
   * type that maps to another tier moves their prices: `pricing.write` for all companies, as a
   * tier set by hand needs (`crm.account.tier.set`).
   */
  pricing: boolean;
}

/** The permissions a change of a customer's type from `from` to `to` needs besides its own. */
export function accountTypeChangeNeeds(
  change: { from: AccountType; to: AccountType; ownTierId: string | null },
  tierByType: Readonly<Partial<Record<AccountType, string>>> = WORKSHOP_DEFAULTS.pricing
    .tierByAccountType,
): AccountTypeChangeNeeds {
  if (change.from === change.to) return { credit: false, pricing: false };
  return {
    credit: (change.from === 'dealer') !== (change.to === 'dealer'),
    pricing: change.ownTierId === null && tierByType[change.from] !== tierByType[change.to],
  };
}
