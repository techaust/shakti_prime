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
      '<FETCH>GUID, ALTERID, VOUCHERTYPENAME, DATE, VOUCHERNUMBER, PARTYLEDGERNAME, AMOUNT,',
      ' ISCANCELLED, BASICBUYERORDERNO</FETCH>',
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

/** Tally amounts carry a sign for debit or credit; the BOS keeps rupees with two decimals. */
function money(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const n = Number(value.replaceAll(',', ''));
  return Number.isFinite(n) ? Math.abs(n).toFixed(2) : undefined;
}

/** Vouchers from an export answer, in the connector's batch shape. Unreadable ones are skipped. */
export function parseVoucherExport(xml: string): Record<string, unknown>[] {
  const vouchers: Record<string, unknown>[] = [];
  for (const match of xml.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)) {
    const block = match[1] ?? '';
    const guid = tag(block, 'GUID');
    const alterId = Number(tag(block, 'ALTERID'));
    if (guid === undefined || !Number.isSafeInteger(alterId)) continue;
    const buyerOrderNo = tag(block, 'BASICBUYERORDERNO');
    const partyLedger = tag(block, 'PARTYLEDGERNAME');
    vouchers.push({
      guid,
      alterId,
      voucherType: tag(block, 'VOUCHERTYPENAME'),
      date: isoDate(tag(block, 'DATE')),
      number: tag(block, 'VOUCHERNUMBER') ?? '',
      amount: money(tag(block, 'AMOUNT')),
      cancelled: tag(block, 'ISCANCELLED') === 'Yes',
      ...(partyLedger === undefined || partyLedger === '' ? {} : { partyLedger }),
      ...(buyerOrderNo === undefined || buyerOrderNo === '' ? {} : { buyerOrderNo }),
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
