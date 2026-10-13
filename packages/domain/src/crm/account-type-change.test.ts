import { describe, expect, it } from 'vitest';
import { accountTypeChangeNeeds } from './account-type-change';

describe('accountTypeChangeNeeds (DOM-1)', () => {
  const none = {};

  it('needs nothing when the type stays', () => {
    expect(accountTypeChangeNeeds({ from: 'dealer', to: 'dealer', ownTierId: null })).toEqual({
      credit: false,
      pricing: false,
    });
  });

  it('needs the credit permission to make a customer a dealer, or to stop being one', () => {
    expect(
      accountTypeChangeNeeds({ from: 'household', to: 'dealer', ownTierId: 't' }, none).credit,
    ).toBe(true);
    expect(
      accountTypeChangeNeeds({ from: 'dealer', to: 'business', ownTierId: 't' }, none).credit,
    ).toBe(true);
    expect(
      accountTypeChangeNeeds({ from: 'household', to: 'farm', ownTierId: 't' }, none).credit,
    ).toBe(false);
  });

  it('needs the pricing permission when the workshop map would move a customer with no tier of their own', () => {
    const map = { household: 'retail', farm: 'retail', business: 'trade' };
    expect(
      accountTypeChangeNeeds({ from: 'household', to: 'business', ownTierId: null }, map).pricing,
    ).toBe(true);
    expect(
      accountTypeChangeNeeds({ from: 'household', to: 'farm', ownTierId: null }, map).pricing,
    ).toBe(false);
    expect(
      accountTypeChangeNeeds({ from: 'household', to: 'dealer', ownTierId: null }, map).pricing,
    ).toBe(true);
  });

  it('leaves a customer with a tier of their own on that tier, whatever the map says', () => {
    const map = { household: 'retail', business: 'trade' };
    expect(
      accountTypeChangeNeeds({ from: 'household', to: 'business', ownTierId: 't' }, map).pricing,
    ).toBe(false);
  });

  it('moves no one while the map is empty, as it is until the workshop fills it', () => {
    expect(
      accountTypeChangeNeeds({ from: 'household', to: 'business', ownTierId: null }).pricing,
    ).toBe(false);
  });
});
