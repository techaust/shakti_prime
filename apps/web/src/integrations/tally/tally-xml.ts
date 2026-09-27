import { voucherTypeOf } from './payloads';

/**
 * Reading Tally Prime over its XML server (port 9000 on the accounts machine), for the spike only:
 * the Windows connector (`apps/tally-connector`, Phase 5) owns this in production and pushes to the
 * BOS; the BOS never calls Tally (CLAUDE.md, "Tally is read-only"). Field names follow Tally's
 * standard voucher object and are confirmed at the Tally discovery visit (ROADMAP §2).
 */

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function envelope(company: string, collection: string, tdl: string): string {
  return [
    '<ENVELOPE>',
    '<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE>',
    `<ID>${collection}</ID></HEADER>`,
    '<BODY><DESC><STATICVARIABLES>',
    `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>`,
    '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>',
    '</STATICVARIABLES>',
    `<TDL><TDLMESSAGE>${tdl}</TDLMESSAGE></TDL>`,
    '</DESC></BODY></ENVELOPE>',
  ].join('');
}

/** Vouchers of a company altered after `sinceAlterId`, oldest change first. */
export function vouchersSinceRequest(company: string, sinceAlterId: number): string {
  if (!Number.isSafeInteger(sinceAlterId) || sinceAlterId < 0) {
    throw new Error('sinceAlterId must be a whole number');
  }
  return envelope(
    company,
    'BOSVouchersSince',
    [
      '<COLLECTION NAME="BOSVouchersSince" ISMODIFY="No">',
      '<TYPE>Voucher</TYPE>',
      '<FETCH>GUID, ALTERID, VOUCHERTYPENAME, DATE, VOUCHERNUMBER, PARTYLEDGERNAME, PARTYGSTIN,',
      ' AMOUNT, ISCANCELLED, ISOPTIONAL, BASICBUYERORDERNO, ALLLEDGERENTRIES.LIST,',
      ' ALLINVENTORYENTRIES.LIST</FETCH>',
      '<FILTER>BOSAfterCursor</FILTER>',
      '<SORT>$ALTERID</SORT>',
      '</COLLECTION>',
      `<SYSTEM TYPE="Formulae" NAME="BOSAfterCursor">$ALTERID &gt; ${String(sinceAlterId)}</SYSTEM>`,
    ].join(''),
  );
}

/** Every voucher GUID of a company: the daily snapshot. */
export function voucherGuidsRequest(company: string): string {
  return envelope(
    company,
    'BOSVoucherGuids',
    '<COLLECTION NAME="BOSVoucherGuids" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID</FETCH></COLLECTION>',
  );
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
  if (value === undefined) return undefined;
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

/** The voucher's own fields: the nested `*.LIST` blocks removed, so their tags are not read. */
function headerOf(block: string): string {
  return block.replaceAll(/<([A-Z]+(?:\.[A-Z]+)*\.LIST)\b[^>]*>[\s\S]*?<\/\1>/g, '');
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

/**
 * Vouchers from an export answer, in the contract's `TallyVoucher` shape (checked afterwards by
 * `parseBatch`). A voucher without a GUID or AlterID, or of a type the BOS does not read, is
 * skipped.
 */
export function parseVoucherExport(xml: string): Record<string, unknown>[] {
  const vouchers: Record<string, unknown>[] = [];
  for (const match of xml.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)) {
    const block = match[1] ?? '';
    const header = headerOf(block);
    const guid = tag(header, 'GUID');
    const alterId = Number(tag(header, 'ALTERID'));
    const typeName = tag(header, 'VOUCHERTYPENAME') ?? '';
    const type = voucherTypeOf(typeName);
    if (guid === undefined || !Number.isSafeInteger(alterId) || type === undefined) continue;
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

/** GUIDs from a snapshot answer. */
export function parseGuidExport(xml: string): string[] {
  return [...xml.matchAll(/<GUID\b[^>]*>([\s\S]*?)<\/GUID>/g)]
    .map((m) => decodeXml(m[1] ?? ''))
    .filter((g) => g !== '');
}
