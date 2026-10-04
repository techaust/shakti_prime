import { sql } from 'drizzle-orm';
import { check, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { actorsRequired, timestamps } from './columns';

/**
 * The PIN code master (PRD CRM-02, docs/design/phase1.md §6.3): one row per post office of the
 * public India Post directory, shared by every company. Requests read it; only the `pin_codes`
 * import writes it, as an Executive in a request for every company. A site's PIN fills its tehsil,
 * district and state from here (`customer_sites_pin_fill`), and its offices are offered as the
 * village; a PIN not found here flags the site for review.
 */
export const pinCodes = pgTable(
  'pin_codes',
  {
    id: uuid('id').primaryKey(),
    pin: text('pin').notNull(),
    officeName: text('office_name').notNull(),
    /** The sub-district; screens say tehsil. Left out by some editions of the directory. */
    taluk: text('taluk'),
    district: text('district').notNull(),
    /** Two-digit GST state code, from the directory's state name. */
    stateCode: text('state_code'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('pin_codes_pin_check', sql`${t.pin} ~ '^[1-9][0-9]{5}$'`),
    check('pin_codes_office_name_check', sql`char_length(${t.officeName}) between 1 and 120`),
    check('pin_codes_taluk_check', sql`${t.taluk} is null or char_length(${t.taluk}) between 1 and 120`),
    check('pin_codes_district_check', sql`char_length(${t.district}) between 2 and 120`),
    check(
      'pin_codes_state_code_check',
      sql`${t.stateCode} is null or ${t.stateCode} ~ '^[0-9]{2}$'`,
    ),
    // One row per office of a PIN; the lookup by PIN uses this index's leading column.
    unique('pin_codes_pin_office_unique').on(t.pin, t.officeName),
  ],
);
