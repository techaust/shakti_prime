// Synthetic catalogue, pricing, tax and numbering rows for the security suite, written with the
// migrator connection. Fixed ids so the fixture is re-creatable; values are test data, never copy.
import { tierId } from '../../seeds/price-tiers';
import { asMigrator } from './index';

/** Prefix for fixture ids; four hex characters follow. */
export const CATALOGUE_FIXTURE_PREFIX = '01990000-0000-7000-8000-0000000c';
const P = CATALOGUE_FIXTURE_PREFIX;
const id = (n: number): string => `${P}${n.toString(16).padStart(4, '0')}`;

export interface CatalogueFixture {
  /** A principal row that signs the seeded price-change-log entry. */
  execPrincipalId: string;
  items: { pump: string; panel: string; cable: string };
  kit: string;
  /** `item_costs` ids: two for entity 1, one for entity 2. */
  costs: { e1: string[]; e2: string[] };
  priceLists: { sharedRetail: string; dealerEntity2: string };
  priceListItems: { sharedPump: string; sharedKit: string; dealerPump: string };
  priceChangeLog: string;
  taxRate: string;
  compositeRule: string;
  /** `document_sequences` row for entity 1 quotes. */
  sequence: string;
}

export async function catalogueFixture(): Promise<CatalogueFixture> {
  const fx: CatalogueFixture = {
    execPrincipalId: id(0x0201),
    items: { pump: id(0x1001), panel: id(0x1002), cable: id(0x1003) },
    kit: id(0x1101),
    costs: { e1: [id(0x1301), id(0x1302)], e2: [id(0x1303)] },
    priceLists: { sharedRetail: id(0x1401), dealerEntity2: id(0x1402) },
    priceListItems: { sharedPump: id(0x1411), sharedKit: id(0x1412), dealerPump: id(0x1421) },
    priceChangeLog: id(0x1431),
    taxRate: id(0x1501),
    compositeRule: id(0x1601),
    sequence: id(0x1701),
  };
  const like = `${P}%`;

  await asMigrator(async (m) => {
    await m.begin(async (tx) => {
      // Remove a previous run in dependency order. The append-only trigger is paused for the log.
      await tx`alter table price_change_log disable trigger price_change_log_append_only`;
      await tx`delete from price_change_log where id::text like ${like}`;
      await tx`alter table price_change_log enable trigger price_change_log_append_only`;
      await tx`delete from price_list_items where id::text like ${like}`;
      await tx`delete from price_lists where id::text like ${like}`;
      await tx`delete from kit_components where id::text like ${like}`;
      await tx`delete from kits where id::text like ${like}`;
      await tx`delete from item_costs where id::text like ${like}`;
      await tx`delete from pump_curves where id::text like ${like}`;
      await tx`delete from tax_rates where id::text like ${like}`;
      await tx`delete from composite_supply_rules where id::text like ${like}`;
      await tx`delete from document_sequences where id::text like ${like}`;
      await tx`delete from items where id::text like ${like}`;
      await tx`delete from principals where id::text like ${like}`;

      await tx`insert into principals (id, kind, display_name) values (${fx.execPrincipalId}, 'user', 'fixture executive')`;

      await tx`insert into items (id, sku, name, name_hi, category, hsn, unit, is_serial_tracked) values
        (${fx.items.pump}, 'FX-PUMP', 'fixture pump', 'fixture pump hi', 'pump', '8413', 'nos', true),
        (${fx.items.panel}, 'FX-PANEL', 'fixture panel', 'fixture panel hi', 'panel', '8541', 'nos', true),
        (${fx.items.cable}, 'FX-CABLE', 'fixture cable', 'fixture cable hi', 'cable', '8544', 'metre', false)`;
      await tx`insert into pump_curves (id, item_id, head_m, flow_lph) values
        (${id(0x1201)}, ${fx.items.pump}, 30.00, 12000.00), (${id(0x1202)}, ${fx.items.pump}, 50.00, 8000.00)`;
      await tx`insert into kits (id, sku, name, name_hi) values (${fx.kit}, 'FX-KIT', 'fixture kit', 'fixture kit hi')`;
      await tx`insert into kit_components (id, kit_id, item_id, qty) values
        (${id(0x1111)}, ${fx.kit}, ${fx.items.pump}, 1.000), (${id(0x1112)}, ${fx.kit}, ${fx.items.cable}, 25.000)`;
      await tx`insert into item_costs (id, item_id, entity_id, moving_avg_cost, last_purchase_rate, as_of) values
        (${fx.costs.e1[0] ?? ''}, ${fx.items.pump}, 1, 1000.0000, 1050.0000, now()),
        (${fx.costs.e1[1] ?? ''}, ${fx.items.panel}, 1, 200.0000, 210.0000, now()),
        (${fx.costs.e2[0] ?? ''}, ${fx.items.pump}, 2, 990.0000, 1000.0000, now())`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from) values
        (${fx.priceLists.sharedRetail}, ${tierId('retail')}, null, 1, '2026-04-01'),
        (${fx.priceLists.dealerEntity2}, ${tierId('dealer')}, 2, 1, '2026-04-01')`;
      await tx`insert into price_list_items (id, price_list_id, item_id, kit_id, price) values
        (${fx.priceListItems.sharedPump}, ${fx.priceLists.sharedRetail}, ${fx.items.pump}, null, 1500.00),
        (${fx.priceListItems.sharedKit}, ${fx.priceLists.sharedRetail}, null, ${fx.kit}, 4000.00),
        (${fx.priceListItems.dealerPump}, ${fx.priceLists.dealerEntity2}, ${fx.items.pump}, null, 1300.00)`;
      await tx`insert into price_change_log (id, price_list_item_id, old_price, new_price, changed_by) values
        (${fx.priceChangeLog}, ${fx.priceListItems.sharedPump}, null, 1500.00, ${fx.execPrincipalId})`;
      await tx`insert into tax_rates (id, hsn, rate_pct, effective_from, source_ref) values
        (${fx.taxRate}, '8413', 5.00, '2025-09-22', 'fixture')`;
      await tx`insert into composite_supply_rules (id, segment, goods_share_pct, services_share_pct, goods_rate_pct, services_rate_pct, effective_from) values
        (${fx.compositeRule}, 'commercial_epc', 70.00, 30.00, 5.00, 18.00, '2025-09-22')`;
      await tx`insert into document_sequences (id, entity_id, doc_type, fy, prefix, next_no) values
        (${fx.sequence}, 1, 'quote', '2026-27', 'SS/Q', 1)`;
    });
  });

  return fx;
}

/** A fixed staff user with one role so `users` and `user_entity_roles` are readable in the loops. */
export const IDENTITY_FIXTURE_USER_ID = '01990000-0000-7000-8000-0000000a0001';

export async function identityFixture(): Promise<void> {
  const userId = IDENTITY_FIXTURE_USER_ID;
  await asMigrator((m) =>
    m.begin(async (tx) => {
      // Remove a previous run, whichever id it carried.
      await tx`delete from sessions where user_id in (select id from users where email = 'fixture.user@shakti.test')`;
      await tx`delete from user_entity_roles where user_id in (select id from users where email = 'fixture.user@shakti.test')`;
      await tx`delete from users where email = 'fixture.user@shakti.test'`;
      await tx`delete from principals where display_name = 'fixture user' and kind = 'user'`;
      await tx`insert into principals (id, kind, display_name) values (${userId}, 'user', 'fixture user')
        on conflict (id) do nothing`;
      await tx`insert into users (id, name, email, status, two_factor_enabled)
        values (${userId}, 'fixture user', 'fixture.user@shakti.test', 'active', true)
        on conflict (id) do nothing`;
      await tx`insert into user_entity_roles (id, user_id, entity_id, role_id)
        values (${'01990000-0000-7000-8000-0000000a0002'}, ${userId}, 1, (select id from roles where key = 'accounts'))
        on conflict (id) do nothing`;
    }),
  );
}
