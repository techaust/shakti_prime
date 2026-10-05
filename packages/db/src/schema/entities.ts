import { sql } from 'drizzle-orm';
import { boolean, check, jsonb, pgTable, smallint, text } from 'drizzle-orm/pg-core';
import { actors, archivable, timestamps } from './columns';

/**
 * The four selling entities (docs/DATABASE.md §6.1). The registered address is entered in Admin by
 * an Executive (workshop pack SALE-2); its state is `state_code`, which the GSTIN starts with.
 * The company's current logo and letterhead are its newest ready files of those purposes
 * (`files`). `bank_json` holds the bank account sealed by the field cipher (bank name, account
 * number, IFSC and branch, never in clear); no request role may select it, and it is read only
 * through `app.entity_bank_envelope()`, by an Executive or the render worker.
 */
export const entities = pgTable(
  'entities',
  {
    id: smallint('id').primaryKey(),
    code: text('code').notNull().unique(),
    legalName: text('legal_name').notNull(),
    brandName: text('brand_name').notNull(),
    gstin: text('gstin'),
    stateCode: text('state_code').notNull(),
    upiId: text('upi_id'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    pin: text('pin'),
    bankJson: jsonb('bank_json'),
    /** Whether a bank account is recorded, readable where the sealed value is not. */
    bankDetailsSet: boolean('bank_details_set')
      .notNull()
      .generatedAlwaysAs(sql`bank_json is not null`),
    ...archivable,
    ...timestamps,
    ...actors,
  },
  (t) => [
    check('entities_code_check', sql`${t.code} ~ '^[A-Z0-9]{2,10}$'`),
    check('entities_state_code_check', sql`${t.stateCode} ~ '^[0-9]{2}$'`),
    check(
      'entities_gstin_check',
      sql`${t.gstin} is null or ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check('entities_pin_check', sql`${t.pin} is null or ${t.pin} ~ '^[1-9][0-9]{5}$'`),
  ],
);
