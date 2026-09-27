import {
  DomainError,
  type PlaceOfSupply,
  type StateCode,
  type SupplySource,
} from '@shakti/contracts';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';

export interface SupplyParties {
  /** `customer_sites.state_code` when the document has a site. */
  siteStateCode?: string | null | undefined;
  /** The account's GSTIN; its first two digits are the state code. */
  accountGstin?: string | null | undefined;
  /** The selling entity's own `state_code`. */
  entityStateCode: string;
}

const STATE = /^[0-9]{2}$/;
const GSTIN = /^([0-9]{2})[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function stateOf(source: SupplySource, parties: SupplyParties): StateCode | undefined {
  switch (source) {
    case 'site': {
      const code = parties.siteStateCode;
      return code && STATE.test(code) ? code : undefined;
    }
    case 'account_gstin': {
      const gstin = parties.accountGstin;
      return gstin ? GSTIN.exec(gstin)?.[1] : undefined;
    }
    case 'entity':
      return STATE.test(parties.entityStateCode) ? parties.entityStateCode : undefined;
  }
}

/**
 * Place of supply (ADR 0007): the site's state, else the state in the account's GSTIN, else the
 * entity's own state (order in `WORKSHOP_DEFAULTS.tax`). Intra-state when it equals the entity's
 * state: CGST and SGST; otherwise IGST.
 */
export function placeOfSupply(parties: SupplyParties): PlaceOfSupply {
  if (!STATE.test(parties.entityStateCode)) {
    throw new DomainError('internal', 'entity state code is not two digits');
  }
  for (const source of WORKSHOP_DEFAULTS.tax.placeOfSupplyOrder) {
    const stateCode = stateOf(source, parties);
    if (stateCode !== undefined) {
      return {
        stateCode,
        kind: stateCode === parties.entityStateCode ? 'intra' : 'inter',
        source,
      };
    }
  }
  // The entity's state is always present, so the loop returns unless the order omits `entity`.
  return { stateCode: parties.entityStateCode, kind: 'intra', source: 'entity' };
}
