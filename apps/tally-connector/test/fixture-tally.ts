import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for Tally Prime's XML server, for the connector's tests. It answers the connector's
 * collection exports (company status, vouchers, party ledgers, voucher GUIDs) by AlterID window,
 * in the shapes of `test/fixtures/vouchers-export.xml` (the spike's recording) and Tally's
 * documented export format: `TYPE` attributes, numbers with a leading space, dates as `YYYYMMDD`,
 * signed amounts. Knobs make it slow, failing, silent or altered.
 *
 * As Tally does, it reads vouchers only within the request's period (`SVFROMDATE` to `SVTODATE`),
 * or within the company's current period when the request names none.
 *
 * It refuses anything but an `Export`, so a test fails if the connector ever asks Tally to change.
 */

export type FixtureVoucherType =
  'Sales' | 'Receipt' | 'Credit Note' | 'Purchase' | 'Debit Note' | 'Journal' | 'Sales GST';

export interface FixtureVoucher {
  guid: string;
  alterId: number;
  type: FixtureVoucherType;
  number: string;
  date: string;
  party: string;
  gstin?: string;
  buyerOrderNo?: string;
  amount: number;
  cancelled?: boolean;
  /** A voucher Tally gives without ledger lines (as some cancelled vouchers are). */
  noEntries?: boolean;
}

export interface FixtureLedger {
  guid: string;
  alterId: number;
  name: string;
  gstin?: string;
  opening: number;
  closing: number;
}

interface Company {
  guid: string;
  /** Undefined for a company whose status gives no `BOOKSFROM`. */
  booksFrom: string | undefined;
  /** The period Tally reads when a request names none (`YYYYMMDD`). */
  currentPeriod: { from: string; to: string };
  alterSeq: number;
  masterSeq: number;
  /** Tally's `$AltVchId` and `$AltMstId`: the last AlterID given to a voucher and to a master. */
  altVch: number;
  altMst: number;
  open: boolean;
  vouchers: Map<string, FixtureVoucher>;
  ledgers: Map<string, FixtureLedger>;
}

export interface FixtureRequest {
  collection: string;
  company: string;
  tallyRequest: string;
  /** `SVFROMDATE` and `SVTODATE`, when the request names a period. */
  from: string | undefined;
  to: string | undefined;
  after: number | undefined;
  upTo: number | undefined;
  startedAt: number;
  endedAt: number | undefined;
}

export interface FixtureKnobs {
  /** Milliseconds before each answer. */
  delayMs: number;
  /** The next N requests answer 500. */
  failNext: number;
  /** The next N requests never answer (the connector's timeout ends them). */
  hangNext: number;
  /** Answer in UTF-16 with a byte-order mark, as Tally does when set to Unicode. */
  utf16: boolean;
}

const BASE_TYPE: Record<FixtureVoucherType, string> = {
  Sales: 'Sales',
  'Sales GST': 'Sales',
  Receipt: 'Receipt',
  'Credit Note': 'Credit Note',
  Purchase: 'Purchase',
  'Debit Note': 'Debit Note',
  Journal: 'Journal',
};

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function unescape(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

const amount = (n: number) => n.toFixed(2);

function voucherXml(v: FixtureVoucher, fields: 'full' | 'guid'): string {
  const head = [
    `<VOUCHER REMOTEID="${v.guid}" VCHTYPE="${escape(v.type)}" ACTION="Create" OBJVIEW="Invoice Voucher View">`,
    ` <GUID TYPE="String">${v.guid}</GUID>`,
    ` <ALTERID TYPE="Number"> ${String(v.alterId)}</ALTERID>`,
    ` <DATE TYPE="Date">${v.date}</DATE>`,
    ` <VOUCHERTYPENAME TYPE="String">${escape(v.type)}</VOUCHERTYPENAME>`,
    ` <BOSBASETYPE TYPE="String">${escape(BASE_TYPE[v.type])}</BOSBASETYPE>`,
  ];
  if (fields === 'guid') return [...head, '</VOUCHER>'].join('\n');
  const sign = v.type === 'Sales' || v.type === 'Sales GST' || v.type === 'Debit Note' ? -1 : 1;
  return [
    ...head,
    ` <VOUCHERNUMBER TYPE="String">${escape(v.number)}</VOUCHERNUMBER>`,
    ` <PARTYLEDGERNAME TYPE="String">&#4; ${escape(v.party)}</PARTYLEDGERNAME>`,
    v.gstin === undefined ? '' : ` <PARTYGSTIN TYPE="String">${v.gstin}</PARTYGSTIN>`,
    ` <AMOUNT TYPE="Amount">${amount(sign * v.amount)}</AMOUNT>`,
    ` <ISCANCELLED TYPE="Logical">${v.cancelled === true ? 'Yes' : 'No'}</ISCANCELLED>`,
    ' <ISOPTIONAL TYPE="Logical">No</ISOPTIONAL>',
    v.buyerOrderNo === undefined
      ? ''
      : ` <BASICBUYERORDERNO TYPE="String">${escape(v.buyerOrderNo)}</BASICBUYERORDERNO>`,
    ...(v.noEntries === true
      ? []
      : [
          ' <ALLLEDGERENTRIES.LIST>',
          `  <LEDGERNAME TYPE="String">${escape(v.party)}</LEDGERNAME>`,
          `  <AMOUNT TYPE="Amount">${amount(sign * v.amount)}</AMOUNT>`,
          ' </ALLLEDGERENTRIES.LIST>',
          ' <ALLLEDGERENTRIES.LIST>',
          '  <LEDGERNAME TYPE="String">Sales GST 18%</LEDGERNAME>',
          `  <AMOUNT TYPE="Amount">${amount(-sign * v.amount)}</AMOUNT>`,
          ' </ALLLEDGERENTRIES.LIST>',
        ]),
    '</VOUCHER>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function ledgerXml(l: FixtureLedger): string {
  return [
    `<LEDGER NAME="${escape(l.name)}" RESERVEDNAME="">`,
    ` <GUID TYPE="String">${l.guid}</GUID>`,
    ` <ALTERID TYPE="Number"> ${String(l.alterId)}</ALTERID>`,
    ' <PARENT TYPE="String">Sundry Debtors</PARENT>',
    ` <OPENINGBALANCE TYPE="Amount">${amount(l.opening)}</OPENINGBALANCE>`,
    ` <CLOSINGBALANCE TYPE="Amount">${amount(l.closing)}</CLOSINGBALANCE>`,
    ' <NAME.LIST TYPE="String">',
    `  <NAME>${escape(l.name)}</NAME>`,
    ' </NAME.LIST>',
    l.gstin === undefined
      ? ''
      : [
          ' <LEDGSTREGDETAILS.LIST>',
          '  <APPLICABLEFROM TYPE="Date">20170701</APPLICABLEFROM>',
          `  <GSTIN TYPE="String">${l.gstin}</GSTIN>`,
          ' </LEDGSTREGDETAILS.LIST>',
        ].join('\n'),
    '</LEDGER>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function envelope(data: string): string {
  return [
    '<ENVELOPE>',
    ' <HEADER>',
    '  <VERSION>1</VERSION>',
    '  <STATUS>1</STATUS>',
    ' </HEADER>',
    ' <BODY>',
    '  <DESC></DESC>',
    '  <DATA>',
    '   <COLLECTION>',
    data,
    '   </COLLECTION>',
    '  </DATA>',
    ' </BODY>',
    '</ENVELOPE>',
  ].join('\n');
}

function read(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

const inRange = (alterId: number, after: number | undefined, upTo: number | undefined) =>
  (after === undefined || alterId > after) && (upTo === undefined || alterId <= upTo);

export class FixtureTally {
  readonly requests: FixtureRequest[] = [];
  readonly knobs: FixtureKnobs = { delayMs: 0, failNext: 0, hangNext: 0, utf16: false };
  readonly version = 'TallyPrime 5.1';
  private readonly companies = new Map<string, Company>();
  private server: Server | undefined;
  private inFlight = 0;
  /** The most requests the server ever held at once. */
  maxInFlight = 0;
  url = '';

  /** `booksFrom: null` makes a company whose status gives no first day of its books. */
  addCompany(
    name: string,
    options: { booksFrom?: string | null; companyGuid?: string } = {},
  ): void {
    const index = this.companies.size + 1;
    this.companies.set(name, {
      guid:
        options.companyGuid ??
        `5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a${index.toString(16).padStart(2, '0')}`,
      booksFrom: options.booksFrom === null ? undefined : (options.booksFrom ?? '20240401'),
      currentPeriod: { from: '20260401', to: '20270331' },
      alterSeq: 0,
      masterSeq: 0,
      altVch: 0,
      altMst: 0,
      open: true,
      vouchers: new Map(),
      ledgers: new Map(),
    });
  }

  private company(name: string): Company {
    const company = this.companies.get(name);
    if (company === undefined) throw new Error(`no fixture company ${name}`);
    return company;
  }

  /** The company's first day of the books, or none (`undefined`) in its status. */
  setBooksFrom(name: string, booksFrom: string | undefined): void {
    this.company(name).booksFrom = booksFrom;
  }

  /** Closes or opens the company in Tally. */
  setOpen(name: string, open: boolean): void {
    this.company(name).open = open;
  }

  addVoucher(
    name: string,
    voucher: Omit<FixtureVoucher, 'guid' | 'alterId' | 'number' | 'date' | 'party' | 'amount'> &
      Partial<Pick<FixtureVoucher, 'number' | 'date' | 'party' | 'amount'>>,
  ): FixtureVoucher {
    const company = this.company(name);
    company.masterSeq += 1;
    company.alterSeq += 1;
    const seq = company.masterSeq;
    const created: FixtureVoucher = {
      guid: `${company.guid}-${seq.toString(16).padStart(8, '0')}`,
      alterId: company.alterSeq,
      number: `V/${String(seq).padStart(4, '0')}`,
      date: '20260927',
      party: `Party ${String(seq)} & Sons`,
      amount: 1000 + seq,
      ...voucher,
    };
    company.vouchers.set(created.guid, created);
    company.altVch = created.alterId;
    return created;
  }

  /** Edits a voucher: Tally gives it the next AlterID. */
  alterVoucher(name: string, guid: string, changes: Partial<FixtureVoucher> = {}): FixtureVoucher {
    const company = this.company(name);
    const voucher = company.vouchers.get(guid);
    if (voucher === undefined) throw new Error('no such voucher');
    company.alterSeq += 1;
    const altered = {
      ...voucher,
      amount: voucher.amount + 1,
      ...changes,
      alterId: company.alterSeq,
    };
    company.vouchers.set(guid, altered);
    company.altVch = altered.alterId;
    return altered;
  }

  deleteVoucher(name: string, guid: string): void {
    this.company(name).vouchers.delete(guid);
  }

  addLedger(name: string, ledger: Partial<FixtureLedger> = {}): FixtureLedger {
    const company = this.company(name);
    company.masterSeq += 1;
    company.alterSeq += 1;
    const seq = company.masterSeq;
    const created: FixtureLedger = {
      guid: `${company.guid}-${seq.toString(16).padStart(8, '0')}`,
      alterId: company.alterSeq,
      name: `Dealer ${String(seq)}`,
      opening: 0,
      closing: -5000 - seq,
      ...ledger,
    };
    company.ledgers.set(created.guid, created);
    company.altMst = created.alterId;
    return created;
  }

  /**
   * Masters the connector never reads (stock items, other ledgers) altered `count` times: AlterIDs
   * the pages pass over with nothing to carry.
   */
  alterOtherMasters(name: string, count: number): void {
    const company = this.company(name);
    company.alterSeq += count;
    company.altMst = company.alterSeq;
  }

  /** A voucher posted to the ledger: its balance moves, its AlterID does not. */
  setClosing(name: string, guid: string, closing: number): void {
    const ledger = this.company(name).ledgers.get(guid);
    if (ledger === undefined) throw new Error('no such ledger');
    ledger.closing = closing;
  }

  vouchersOf(name: string): FixtureVoucher[] {
    return [...this.company(name).vouchers.values()].sort((a, b) => a.alterId - b.alterId);
  }

  lastAlterId(name: string): number {
    return this.company(name).alterSeq;
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${String(port)}`;
  }

  async close(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => {
      if (this.server === undefined) {
        resolve();
        return;
      }
      this.server.close(() => {
        resolve();
      });
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const xml = await read(request);
    const range = /\$ALTERID &gt; (\d+)(?: AND \$ALTERID &lt;= (\d+))?/.exec(xml);
    const record: FixtureRequest = {
      collection: /<ID>([^<]*)<\/ID>/.exec(xml)?.[1] ?? '',
      company: unescape(/<SVCURRENTCOMPANY>([^<]*)<\/SVCURRENTCOMPANY>/.exec(xml)?.[1] ?? ''),
      tallyRequest: /<TALLYREQUEST>([^<]*)<\/TALLYREQUEST>/.exec(xml)?.[1] ?? '',
      from: /<SVFROMDATE[^>]*>([^<]*)<\/SVFROMDATE>/.exec(xml)?.[1],
      to: /<SVTODATE[^>]*>([^<]*)<\/SVTODATE>/.exec(xml)?.[1],
      after: range?.[1] === undefined ? undefined : Number(range[1]),
      upTo: range?.[2] === undefined ? undefined : Number(range[2]),
      startedAt: Date.now(),
      endedAt: undefined,
    };
    this.requests.push(record);
    const finish = (status: number, body: string) => {
      record.endedAt = Date.now();
      this.inFlight -= 1;
      const bytes = this.knobs.utf16
        ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')])
        : Buffer.from(body, 'utf8');
      response.writeHead(status, { 'content-type': 'text/xml' }).end(bytes);
    };
    if (this.knobs.hangNext > 0) {
      this.knobs.hangNext -= 1;
      // Tally busy: no answer. The connection ends when the connector gives up.
      request.socket.once('close', () => {
        record.endedAt = Date.now();
        this.inFlight -= 1;
      });
      return;
    }
    if (this.knobs.delayMs > 0) await new Promise((r) => setTimeout(r, this.knobs.delayMs));
    if (this.knobs.failNext > 0) {
      this.knobs.failNext -= 1;
      finish(500, '');
      return;
    }
    if (record.tallyRequest !== 'Export' || !xml.includes('ISMODIFY="No"')) {
      finish(200, '<RESPONSE>Unknown Request, cannot be processed</RESPONSE>');
      return;
    }
    const company = this.companies.get(record.company);
    if (company === undefined) {
      finish(
        200,
        envelope(
          `<LINEERROR>Could not set 'SVCurrentCompany' to '${escape(record.company)}'</LINEERROR>`,
        ),
      );
      return;
    }
    if (!company.open) {
      finish(200, envelope(''));
      return;
    }
    // Tally reads vouchers within the period asked for, or the company's current period.
    const from = record.from ?? company.currentPeriod.from;
    const to = record.to ?? company.currentPeriod.to;
    const vouchers = [...company.vouchers.values()]
      .filter((v) => inRange(v.alterId, record.after, record.upTo))
      .filter((v) => v.date >= from && v.date <= to)
      .sort((a, b) => a.alterId - b.alterId);
    switch (record.collection) {
      case 'BOSCompanyStatus': {
        finish(
          200,
          envelope(
            [
              `<COMPANY NAME="${escape(record.company)}" RESERVEDNAME="">`,
              ` <NAME TYPE="String">${escape(record.company)}</NAME>`,
              company.booksFrom === undefined
                ? ''
                : ` <BOOKSFROM TYPE="Date">${company.booksFrom}</BOOKSFROM>`,
              ` <ALTVCHID TYPE="Number"> ${String(company.altVch)}</ALTVCHID>`,
              ` <ALTMSTID TYPE="Number"> ${String(company.altMst)}</ALTMSTID>`,
              ` <BOSTALLYVERSION TYPE="String">${this.version}</BOSTALLYVERSION>`,
              '</COMPANY>',
            ]
              .filter((line) => line !== '')
              .join('\n'),
          ),
        );
        return;
      }
      case 'BOSVouchers':
        finish(200, envelope(vouchers.map((v) => voucherXml(v, 'full')).join('\n')));
        return;
      case 'BOSVoucherGuids':
        finish(200, envelope(vouchers.map((v) => voucherXml(v, 'guid')).join('\n')));
        return;
      case 'BOSLedgers':
        finish(
          200,
          envelope(
            [...company.ledgers.values()]
              .filter((l) => inRange(l.alterId, record.after, record.upTo))
              .sort((a, b) => a.alterId - b.alterId)
              .map(ledgerXml)
              .join('\n'),
          ),
        );
        return;
      default:
        finish(200, '<RESPONSE>Unknown Request, cannot be processed</RESPONSE>');
    }
  }
}
