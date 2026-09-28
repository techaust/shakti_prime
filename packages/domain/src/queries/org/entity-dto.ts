import { EntityDto } from '@shakti/contracts';
import type { schema } from '@shakti/db';

type EntityRow = typeof schema.entities.$inferSelect;

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
  });
}
