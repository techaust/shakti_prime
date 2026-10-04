import { PriceListDto, type PriceListState } from '@shakti/contracts';

/** A price list row as the state rules read it; dates are `YYYY-MM-DD` in IST. */
export interface PriceListFacts {
  id: string;
  tierCode: string;
  tierName: string;
  entityId: number | null;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  approvedAt: Date | null;
  archivedAt: Date | null;
}

/**
 * Where a list stands on `today`: a draft prices nothing; an approved list is scheduled before
 * its start, live from it and ended from its end date (exclusive, AUDIT M19). Archived is ended.
 */
export function priceListState(list: PriceListFacts, today: string): PriceListState {
  if (list.archivedAt !== null) return 'ended';
  if (list.approvedAt === null) return 'draft';
  if (list.effectiveTo !== null && list.effectiveTo <= today) return 'ended';
  if (list.effectiveFrom > today) return 'scheduled';
  return 'live';
}

/** The list as Price Master shows it. `open` says its prices may still change. */
export function toPriceListDto(list: PriceListFacts, today: string): PriceListDto {
  return PriceListDto.parse({
    id: list.id,
    tierCode: list.tierCode,
    tierName: list.tierName,
    entityId: list.entityId,
    version: list.version,
    effectiveFrom: list.effectiveFrom,
    effectiveTo: list.effectiveTo,
    open: list.archivedAt === null && (list.effectiveTo === null || list.effectiveTo > today),
    state: priceListState(list, today),
    approvedAt: list.approvedAt?.toISOString() ?? null,
  });
}
