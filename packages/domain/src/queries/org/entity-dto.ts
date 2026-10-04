import { EntityDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { getTableColumns } from 'drizzle-orm';

/**
 * Every column of `entities` a request may select: all but `bank_json`, the sealed bank account,
 * which no request role may select (it is read through `app.entity_bank_envelope()` alone). Every
 * select and `returning` on the table names these columns, never the whole row.
 */
const { bankJson: _sealed, ...readable } = getTableColumns(schema.entities);
export const ENTITY_COLUMNS = readable;

export type EntityRow = Omit<typeof schema.entities.$inferSelect, 'bankJson'>;

/** Whitelists the columns that leave the command layer (AGENTS.md §5). */
export function toEntityDto(row: EntityRow): EntityDto {
  return EntityDto.parse({
    id: row.id,
    code: row.code,
    legalName: row.legalName,
    brandName: row.brandName,
    stateCode: row.stateCode,
    gstin: row.gstin,
    upiId: row.upiId,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    pin: row.pin,
    bankDetailsSet: row.bankDetailsSet,
  });
}
