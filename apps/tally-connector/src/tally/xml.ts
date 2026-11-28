import { TallyVoucherTypeSchema, type TallyVoucherType } from '@shakti/contracts';

/**
 * Tally Prime's XML server (port 9000 on the accounts PC): the requests the connector sends and the
 * readings it takes from the answers (ADR 0013). Every request is an `Export` of a collection with
 * `ISMODIFY="No"`; the connector never sends an `Import` and never changes Tally's books
 * (CLAUDE.md, "Tally is read-only"). Field names follow Tally's standard voucher, ledger and company
 * objects and are confirmed at the Tally discovery visit (docs/04-architecture-appendix/tally.md).
 * This is the one reader of Tally's XML in the repository; it replaced the Phase 0 spike's.
 *
 * Every voucher read names its period from the books' first day: without one, Tally reads only
 * the company's current period, and vouchers of earlier years would be left out unseen.
 */

/** A Tally date (`YYYYMMDD`) for a request's period. */
export type TallyDate = string;

/** The period a voucher collection covers: from the books' first day to `to`. */
export interface TallyPeriod {
  from: TallyDate;
  to: TallyDate;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function tallyDate(value: TallyDate): string {
  if (!/^\d{8}$/.test(value)) throw new Error('a Tally date is eight digits, YYYYMMDD');
  return value;
}

function envelope(company: string, collection: string, tdl: string, period?: TallyPeriod): string {
  return [
    '<ENVELOPE>',
    '<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE>',
    `<ID>${collection}</ID></HEADER>`,
    '<BODY><DESC><STATICVARIABLES>',
    `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>`,
    ...(period === undefined
      ? []
      : [
          `<SVFROMDATE TYPE="Date">${tallyDate(period.from)}</SVFROMDATE>`,
          `<SVTODATE TYPE="Date">${tallyDate(period.to)}</SVTODATE>`,
        ]),
    '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>',
    '</STATICVARIABLES>',
    `<TDL><TDLMESSAGE>${tdl}</TDLMESSAGE></TDL>`,
    '</DESC></BODY></ENVELOPE>',
  ].join('');
}

function alterIdText(value: number, name: string): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return String(value);
}

/** The AlterID window `(after, upTo]` as a TDL filter. */
function rangeFormula(name: string, after: number, upTo: number): string {
  const formula = `$ALTERID &gt; ${alterIdText(after, 'after')} AND $ALTERID &lt;= ${alterIdText(upTo, 'upTo')}`;
  return `<SYSTEM TYPE="Formulae" NAME="${name}">${formula}</SYSTEM>`;
}

/**
 * The company's state: its last voucher and master AlterIDs (`$AltVchId`, `$AltMstId`, so the
 * connector knows where a read ends), the books' first day and Tally's version.
 */
export function companyStatusRequest(company: string): string {
  return envelope(
    company,
    'BOSCompanyStatus',
    [
      '<COLLECTION NAME="BOSCompanyStatus" ISMODIFY="No">',
      '<TYPE>Company</TYPE>',
      '<FETCH>NAME, ALTVCHID, ALTMSTID, BOOKSFROM</FETCH>',
      '<COMPUTE>BOSTALLYVERSION : $$SysInfo:Version</COMPUTE>',
      '<FILTER>BOSCurrentCompany</FILTER>',
      '</COLLECTION>',
      '<SYSTEM TYPE="Formulae" NAME="BOSCurrentCompany">$NAME = ##SVCURRENTCOMPANY</SYSTEM>',
    ].join(''),
  );
}

/**
 * Vouchers of a company with an AlterID in `(after, upTo]`, oldest change first. `BOSBASETYPE` is the
 * voucher type's parent, so a type a company renamed ("Sales GST") still reads as `sales`.
 */
export function vouchersPageRequest(
  company: string,
  after: number,
  upTo: number,
  period: TallyPeriod,
): string {
  return envelope(
    company,
    'BOSVouchers',
    [
      '<COLLECTION NAME="BOSVouchers" ISMODIFY="No">',
      '<TYPE>Voucher</TYPE>',
      '<FETCH>GUID, ALTERID, VOUCHERTYPENAME, DATE, VOUCHERNUMBER, PARTYLEDGERNAME, PARTYGSTIN,',
      ' AMOUNT, ISCANCELLED, ISOPTIONAL, BASICBUYERORDERNO, ALLLEDGERENTRIES.LIST,',
      ' ALLINVENTORYENTRIES.LIST</FETCH>',
      '<COMPUTE>BOSBASETYPE : $PARENT:VOUCHERTYPE:$VOUCHERTYPENAME</COMPUTE>',
      '<FILTER>BOSInRange</FILTER>',
      '<SORT>$ALTERID</SORT>',
      '</COLLECTION>',
      rangeFormula('BOSInRange', after, upTo),
    ].join(''),
    period,
  );
}

/**
 * Party ledgers (under Sundry Debtors) with an AlterID in `(after, upTo]`: their balances serve
 * dealer outstanding. Other ledgers (banks, expenses, suppliers) are not read. The closing balance
 * is as at the period's last day.
 */
export function ledgersPageRequest(
  company: string,
  after: number,
  upTo: number,
  period: TallyPeriod,
): string {
  return envelope(
    company,
    'BOSLedgers',
    [
      '<COLLECTION NAME="BOSLedgers" ISMODIFY="No">',
      '<TYPE>Ledger</TYPE>',
      '<FETCH>GUID, ALTERID, NAME, PARENT, PARTYGSTIN, LEDGSTREGDETAILS.LIST, OPENINGBALANCE,',
      ' CLOSINGBALANCE</FETCH>',
      '<FILTER>BOSInRange, BOSPartyLedger</FILTER>',
      '<SORT>$ALTERID</SORT>',
      '</COLLECTION>',
      rangeFormula('BOSInRange', after, upTo),
      '<SYSTEM TYPE="Formulae" NAME="BOSPartyLedger">$$IsBelongsTo:$$GroupSundryDebtors</SYSTEM>',
    ].join(''),
    period,
  );
}

/**
 * Voucher GUIDs (with their date, AlterID and type) of a company with an AlterID in `(after, upTo]`,
 * for the daily snapshot.
 */
export function voucherGuidsRequest(
  company: string,
  window: { after: number; upTo: number },
  period: TallyPeriod,
): string {
  return envelope(
    company,
    'BOSVoucherGuids',
    [
      '<COLLECTION NAME="BOSVoucherGuids" ISMODIFY="No"><TYPE>Voucher</TYPE>',
      '<FETCH>GUID, DATE, ALTERID, VOUCHERTYPENAME</FETCH>',
      '<COMPUTE>BOSBASETYPE : $PARENT:VOUCHERTYPE:$VOUCHERTYPENAME</COMPUTE>',
      '<FILTER>BOSInRange</FILTER></COLLECTION>',
      rangeFormula('BOSInRange', window.after, window.upTo),
    ].join(''),
    period,
  );
}

// ---- Reading the answers ----

/**
 * Tally answers in UTF-8, or in UTF-16 with a byte-order mark when its export is set to Unicode;
 * either is read. Characters XML does not allow (Tally writes `&#4;` before some names) are
 * removed, whether written as a reference or raw.
 */
export function decodeTallyAnswer(bytes: Uint8Array): string {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
  } else {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  return text
    .replaceAll(/&#(?:x0*(?:[0-8bcef]|1[0-9a-f])|0*(?:[0-8]|1[124-9]|2\d|3[01]));/gi, '')
    .replaceAll(/[^\t\n\r\x20-￿]/gu, '');
}

export type TallyAnswerProblem = 'line_error' | 'unknown_request';

/**
 * Tally answers an error with status 200: `<LINEERROR>` (a company that is not open, a bad
 * formula) or a bare `<RESPONSE>` (a request it cannot read).
 */
export function tallyAnswerProblem(xml: string): TallyAnswerProblem | undefined {
  if (/<LINEERROR\b/.test(xml)) return 'line_error';
  if (/^\s*(?:<\?xml[^>]*>\s*)?<RESPONSE\b/.test(xml)) return 'unknown_request';
  return undefined;
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#13;', '')
    .replaceAll('&#10;', ' ')
    .replaceAll('&amp;', '&')
    .trim();
}

function tag(block: string, name: string): string | undefined {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(block);
  return match?.[1] === undefined ? undefined : decodeXml(match[1]);
}

function attribute(openTag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(openTag);
  return match?.[1] === undefined ? undefined : decodeXml(match[1]);
}

function wholeNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,15}$/.test(value)) return undefined;
  return Number(value);
}

/** Tally dates are `YYYYMMDD`. */
function isoDate(value: string | undefined): string | undefined {
  return value !== undefined && /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : undefined;
}

/**
 * Tally amounts carry a sign for the debit or credit side, formatted as the contract's two-decimal
 * rupee string (`SignedMoneySchema`); `unsigned` drops the sign for a voucher's total (`MoneySchema`).
 */
function money(value: string | undefined, unsigned = false): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value.replaceAll(',', ''));
  if (!Number.isFinite(n)) return undefined;
  return (unsigned ? Math.abs(n) : n).toFixed(2);
}

/** Tally writes a quantity as `2 Nos` and a rate as `62500.00/Nos`. */
function quantityOf(value: string | undefined): { quantity?: string; unit?: string } {
  const match = /^(-?[\d.,]+)\s*(\S+)?$/.exec(value ?? '');
  if (match?.[1] === undefined) return {};
  return {
    quantity: match[1].replaceAll(',', ''),
    ...(match[2] === undefined ? {} : { unit: match[2] }),
  };
}

function rateOf(value: string | undefined): string | undefined {
  const figure = value?.split('/')[0]?.replaceAll(',', '').trim();
  return figure === undefined || figure === '' ? undefined : Number(figure).toFixed(2);
}

function lists(block: string, name: string): string[] {
  const escaped = name.replaceAll('.', '\\.');
  return [...block.matchAll(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, 'g'))].map(
    (m) => m[1] ?? '',
  );
}

/** An object's own fields: the nested `*.LIST` blocks removed, so their tags are not read. */
function headerOf(block: string): string {
  return block.replaceAll(/<([A-Z]+(?:\.[A-Z]+)*\.LIST)\b[^>]*>[\s\S]*?<\/\1>/g, '');
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

function objects(xml: string, name: string): { openTag: string; block: string }[] {
  return [...xml.matchAll(new RegExp(`(<${name}\\b[^>]*>)([\\s\\S]*?)</${name}>`, 'g'))].map(
    (m) => ({ openTag: m[1] ?? '', block: m[2] ?? '' }),
  );
}

/**
 * The BOS voucher type for Tally's type name, or undefined for a type the BOS does not read
 * (journals, contra, payments). A company may rename its types; the reading prefers the type's
 * parent, and the discovery visit confirms the names.
 */
export function voucherTypeOf(typeName: string): TallyVoucherType | undefined {
  const key = typeName.trim().toLowerCase().replaceAll(/\s+/g, '_');
  const result = TallyVoucherTypeSchema.safeParse(key);
  return result.success ? result.data : undefined;
}

/**
 * Vouchers from an export answer, in the contract's `TallyVoucher` shape (checked afterwards against
 * the contract). A voucher without a GUID or AlterID, or of a type the BOS does not read, is
 * skipped.
 */
export function parseVoucherExport(xml: string): Record<string, unknown>[] {
  const vouchers: Record<string, unknown>[] = [];
  for (const { block } of objects(xml, 'VOUCHER')) {
    const header = headerOf(block);
    const guid = tag(header, 'GUID');
    const alterId = wholeNumber(tag(header, 'ALTERID'));
    const typeName = tag(header, 'VOUCHERTYPENAME') ?? '';
    const type = voucherTypeOf(tag(header, 'BOSBASETYPE') ?? '') ?? voucherTypeOf(typeName);
    if (guid === undefined || guid === '' || alterId === undefined || type === undefined) continue;
    const ledgerEntries = [
      ...lists(block, 'ALLLEDGERENTRIES.LIST'),
      ...lists(block, 'LEDGERENTRIES.LIST'),
    ].map((entry) => ({
      ledgerName: tag(entry, 'LEDGERNAME'),
      amount: money(tag(entry, 'AMOUNT')),
    }));
    const inventoryEntries = [
      ...lists(block, 'ALLINVENTORYENTRIES.LIST'),
      ...lists(block, 'INVENTORYENTRIES.LIST'),
    ].map((entry) => {
      const rate = rateOf(tag(entry, 'RATE'));
      return {
        stockItemName: tag(entry, 'STOCKITEMNAME'),
        ...quantityOf(tag(entry, 'ACTUALQTY')),
        ...(rate === undefined ? {} : { rate }),
        amount: money(tag(entry, 'AMOUNT')),
      };
    });
    vouchers.push({
      guid,
      alterId,
      type,
      typeName,
      voucherNo: tag(header, 'VOUCHERNUMBER') ?? '',
      date: isoDate(tag(header, 'DATE')),
      partyName: nonEmpty(tag(header, 'PARTYLEDGERNAME')),
      partyGstin: nonEmpty(tag(header, 'PARTYGSTIN')?.toUpperCase()),
      buyerOrderNo: nonEmpty(tag(header, 'BASICBUYERORDERNO')),
      amount: money(tag(header, 'AMOUNT'), true),
      isCancelled: tag(header, 'ISCANCELLED') === 'Yes',
      isOptional: tag(header, 'ISOPTIONAL') === 'Yes',
      ledgerEntries,
      inventoryEntries,
    });
  }
  return vouchers;
}

/**
 * Party ledgers from an export answer, in the contract's `TallyLedger` shape. The GSTIN is the
 * ledger's own field or, from TallyPrime 3 on, the latest of its GST registration details.
 */
export function parseLedgerExport(xml: string, asOf: string): Record<string, unknown>[] {
  const ledgers: Record<string, unknown>[] = [];
  for (const { openTag, block } of objects(xml, 'LEDGER')) {
    const header = headerOf(block);
    const guid = tag(header, 'GUID');
    const alterId = wholeNumber(tag(header, 'ALTERID'));
    if (guid === undefined || guid === '' || alterId === undefined) continue;
    const registered = lists(block, 'LEDGSTREGDETAILS.LIST')
      .map((entry) => tag(entry, 'GSTIN') ?? '')
      .filter((gstin) => gstin !== '');
    const gstin = nonEmpty(tag(header, 'PARTYGSTIN')) ?? registered.at(-1) ?? null;
    ledgers.push({
      guid,
      alterId,
      name: attribute(openTag, 'NAME') ?? tag(block, 'NAME'),
      parent: tag(header, 'PARENT'),
      gstin: gstin?.toUpperCase() ?? null,
      openingBalance: money(tag(header, 'OPENINGBALANCE')) ?? '0.00',
      closingBalance: money(tag(header, 'CLOSINGBALANCE')) ?? '0.00',
      asOf,
    });
  }
  return ledgers;
}

export interface GuidReading {
  guid: string;
  date: string | undefined;
  alterId: number | undefined;
  /** The BOS's type, or undefined for a voucher type the BOS does not read. */
  type: TallyVoucherType | undefined;
}

/** The vouchers of a snapshot answer: GUID, and the date, AlterID and type when Tally gave them. */
export function parseGuidReadings(xml: string): GuidReading[] {
  return objects(xml, 'VOUCHER').flatMap(({ block }) => {
    const header = headerOf(block);
    const guid = tag(header, 'GUID');
    if (guid === undefined || guid === '') return [];
    return [
      {
        guid,
        date: isoDate(tag(header, 'DATE')),
        alterId: wholeNumber(tag(header, 'ALTERID')),
        type:
          voucherTypeOf(tag(header, 'BOSBASETYPE') ?? '') ??
          voucherTypeOf(tag(header, 'VOUCHERTYPENAME') ?? ''),
      },
    ];
  });
}

/** How many objects of a kind (`VOUCHER`, `LEDGER`) an answer holds, read or not. */
export function objectCount(xml: string, name: string): number {
  return objects(xml, name).length;
}

export interface CompanyStatus {
  /** The highest AlterID of the company's vouchers and masters: where a read ends. */
  lastAlterId: number;
  /** The books' first day (`YYYYMMDD`), the start of every voucher read. */
  booksFrom: TallyDate | undefined;
  tallyVersion: string | undefined;
}

/** The company's state, or undefined when Tally does not have the company open. */
export function parseCompanyStatus(xml: string): CompanyStatus | undefined {
  const company = objects(xml, 'COMPANY')[0];
  if (company === undefined) return undefined;
  const header = headerOf(company.block);
  const vouchers = wholeNumber(tag(header, 'ALTVCHID'));
  const masters = wholeNumber(tag(header, 'ALTMSTID'));
  if (vouchers === undefined && masters === undefined) return undefined;
  const booksFrom = tag(header, 'BOOKSFROM');
  const version = tag(header, 'BOSTALLYVERSION');
  return {
    lastAlterId: Math.max(vouchers ?? 0, masters ?? 0),
    booksFrom: booksFrom !== undefined && /^\d{8}$/.test(booksFrom) ? booksFrom : undefined,
    tallyVersion: version === undefined || version === '' ? undefined : version.slice(0, 40),
  };
}
