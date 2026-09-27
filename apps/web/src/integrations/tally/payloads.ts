import { asArray, asNumber, asObject, asString } from '../http';

/**
 * The bodies the Tally connector pushes (docs/API.md §3.5), read as untrusted input. These are the
 * spike's working shapes, kept local to the harness: the published contracts for the connector
 * endpoints arrive with the API contract work (weeks 7 and 8) and replace them. The routes and the
 * Phase 5 tables (`tally_vouchers`, `tally_purchase_vouchers`, tombstones, heartbeats) do not exist
 * yet, so nothing here is stored.
 */

export const MAX_VOUCHERS_PER_BATCH = 500;
export const MAX_SNAPSHOT_GUIDS = 500_000;

export interface TallyVoucher {
  guid: string;
  alterId: number;
  voucherType: string;
  /** `YYYY-MM-DD`, the voucher date in Tally (IST calendar date). */
  date: string;
  number: string;
  partyLedger: string | undefined;
  /** Two-decimal rupee string, never a float (docs/API.md §1). */
  amount: string;
  /** Tally's "Buyer Order No.", the BOS proforma or sales order number when staff typed it. */
  buyerOrderNo: string | undefined;
  cancelled: boolean;
  /** Purchase vouchers land in the restricted table behind `procurement.rate.read`. */
  restricted: boolean;
}

export interface TallyLedger {
  guid: string;
  alterId: number;
  name: string;
  parent: string;
  gstin: string | undefined;
}

export interface TallyBatch {
  company: string;
  entityCode: string;
  maxAlterId: number;
  vouchers: TallyVoucher[];
  ledgers: TallyLedger[];
}

export interface TallyHeartbeat {
  connectorVersion: string;
  tallyVersion: string;
  companies: { name: string; lastAlterId: number }[];
}

export interface TallySnapshot {
  company: string;
  asOf: Date;
  voucherGuids: string[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^-?\d{1,12}\.\d{2}$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const RESTRICTED_TYPES = new Set(['purchase', 'debit note']);

function text(value: unknown): string | undefined {
  const s = asString(value)?.trim();
  return s === undefined || s === '' ? undefined : s;
}

function alterId(value: unknown): number | undefined {
  const n = asNumber(value);
  return n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

function voucher(value: unknown, index: number, problems: string[]): TallyVoucher | undefined {
  const v = asObject(value);
  const at = `vouchers[${String(index)}]`;
  const guid = text(v?.guid);
  const id = alterId(v?.alterId);
  const voucherType = text(v?.voucherType);
  const date = text(v?.date);
  const number = text(v?.number) ?? '';
  const amount = text(v?.amount);
  if (guid === undefined) problems.push(`${at}.guid`);
  if (id === undefined) problems.push(`${at}.alterId`);
  if (voucherType === undefined) problems.push(`${at}.voucherType`);
  if (date === undefined || !DATE.test(date)) problems.push(`${at}.date`);
  if (amount === undefined || !MONEY.test(amount)) problems.push(`${at}.amount`);
  if (
    guid === undefined ||
    id === undefined ||
    voucherType === undefined ||
    date === undefined ||
    amount === undefined
  ) {
    return undefined;
  }
  return {
    guid,
    alterId: id,
    voucherType,
    date,
    number,
    partyLedger: text(v?.partyLedger),
    amount,
    buyerOrderNo: text(v?.buyerOrderNo),
    cancelled: v?.cancelled === true,
    restricted: RESTRICTED_TYPES.has(voucherType.toLowerCase()),
  };
}

function ledger(value: unknown, index: number, problems: string[]): TallyLedger | undefined {
  const l = asObject(value);
  const at = `ledgers[${String(index)}]`;
  const guid = text(l?.guid);
  const id = alterId(l?.alterId);
  const name = text(l?.name);
  const gstin = text(l?.gstin)?.toUpperCase();
  if (guid === undefined || id === undefined || name === undefined) {
    problems.push(at);
    return undefined;
  }
  if (gstin !== undefined && !GSTIN.test(gstin)) problems.push(`${at}.gstin`);
  return { guid, alterId: id, name, parent: text(l?.parent) ?? '', gstin };
}

/** `POST /connector/tally/batches`. */
export function parseBatch(body: unknown): Parsed<TallyBatch> {
  const b = asObject(body);
  const problems: string[] = [];
  const company = text(b?.company);
  const entityCode = text(b?.entityCode);
  const maxAlterId = alterId(b?.maxAlterId);
  const rawVouchers = asArray(b?.vouchers);
  const rawLedgers = asArray(b?.ledgers);
  if (company === undefined) problems.push('company');
  if (entityCode === undefined) problems.push('entityCode');
  if (maxAlterId === undefined) problems.push('maxAlterId');
  if (rawVouchers.length > MAX_VOUCHERS_PER_BATCH) problems.push('vouchers: too many');
  const vouchers = rawVouchers
    .map((v, i) => voucher(v, i, problems))
    .filter((v): v is TallyVoucher => v !== undefined);
  const ledgers = rawLedgers
    .map((l, i) => ledger(l, i, problems))
    .filter((l): l is TallyLedger => l !== undefined);
  if (
    problems.length > 0 ||
    company === undefined ||
    entityCode === undefined ||
    maxAlterId === undefined
  ) {
    return { ok: false, problems };
  }
  return { ok: true, value: { company, entityCode, maxAlterId, vouchers, ledgers } };
}

/** `POST /connector/tally/heartbeat`. */
export function parseHeartbeat(body: unknown): Parsed<TallyHeartbeat> {
  const b = asObject(body);
  const connectorVersion = text(b?.connectorVersion);
  const tallyVersion = text(b?.tallyVersion);
  const problems: string[] = [];
  const companies = asArray(b?.companies).flatMap((c, i) => {
    const name = text(asObject(c)?.name);
    const last = alterId(asObject(c)?.lastAlterId);
    if (name === undefined || last === undefined) {
      problems.push(`companies[${String(i)}]`);
      return [];
    }
    return [{ name, lastAlterId: last }];
  });
  if (connectorVersion === undefined) problems.push('connectorVersion');
  if (tallyVersion === undefined) problems.push('tallyVersion');
  if (problems.length > 0 || connectorVersion === undefined || tallyVersion === undefined) {
    return { ok: false, problems };
  }
  return { ok: true, value: { connectorVersion, tallyVersion, companies } };
}

/** `POST /connector/tally/snapshot`. */
export function parseSnapshot(body: unknown): Parsed<TallySnapshot> {
  const b = asObject(body);
  const company = text(b?.company);
  const asOfText = text(b?.asOf);
  const asOf = asOfText === undefined ? undefined : new Date(asOfText);
  const raw = asArray(b?.voucherGuids);
  const problems: string[] = [];
  if (company === undefined) problems.push('company');
  if (asOf === undefined || Number.isNaN(asOf.getTime())) problems.push('asOf');
  if (raw.length > MAX_SNAPSHOT_GUIDS) problems.push('voucherGuids: too many');
  const voucherGuids = raw.map(text);
  if (voucherGuids.some((g) => g === undefined)) problems.push('voucherGuids');
  if (problems.length > 0 || company === undefined || asOf === undefined) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    value: {
      company,
      asOf,
      voucherGuids: voucherGuids.filter((g): g is string => g !== undefined),
    },
  };
}
