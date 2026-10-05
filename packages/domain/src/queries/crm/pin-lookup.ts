import { PinLookupDto, type LookupPinInput } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { asc, eq } from 'drizzle-orm';
import { localityName } from '../../imports/pin-codes';

/** Offices of one PIN read at most; the directory lists a few dozen for the largest. */
const MAX_OFFICES = 100;

/** The one value every office of the PIN gives, or null where they differ or leave it out. */
function agreed(values: readonly (string | null)[]): string | null {
  const distinct = new Set(values);
  if (distinct.size !== 1) return null;
  const [only] = distinct;
  return only ?? null;
}

/**
 * What the PIN code master knows of one PIN (PRD CRM-02), for the lead and site forms: its
 * post-office localities, offered for the village, and the tehsil, district and state a site with
 * this PIN is given (`customer_sites_pin_fill` fills them by the same rule: the value every office
 * agrees on). A PIN outside the master answers `known: false`; the site is saved and flagged for
 * review. The master is shared reference data every signed-in request reads; the lookup is one
 * index probe on `pin_codes_pin_office_unique`.
 */
export async function lookupPin(
  ctx: Pick<RequestContext, 'tx'>,
  input: LookupPinInput,
): Promise<PinLookupDto> {
  const p = schema.pinCodes;
  const offices = await ctx.tx
    .select({
      officeName: p.officeName,
      taluk: p.taluk,
      district: p.district,
      stateCode: p.stateCode,
    })
    .from(p)
    .where(eq(p.pin, input.pin))
    .orderBy(asc(p.officeName))
    .limit(MAX_OFFICES);
  return PinLookupDto.parse({
    pin: input.pin,
    known: offices.length > 0,
    tehsil: agreed(offices.map((o) => o.taluk)),
    district: agreed(offices.map((o) => o.district)),
    stateCode: agreed(offices.map((o) => o.stateCode)),
    localities: [...new Set(offices.map((o) => localityName(o.officeName)))],
  });
}
