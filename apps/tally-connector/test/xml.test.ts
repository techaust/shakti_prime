import { ConnectorBatchRequest, TallyLedger } from '@shakti/contracts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  companyStatusRequest,
  decodeTallyAnswer,
  ledgersPageRequest,
  parseCompanyStatus,
  parseGuidExport,
  parseGuidReadings,
  parseLedgerExport,
  parseVoucherExport,
  tallyAnswerProblem,
  voucherGuidsRequest,
  voucherTypeOf,
  vouchersPageRequest,
} from '../src/tally/xml';

const GUID_A = '5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000a11';
const GUID_B = '5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000a12';
const xml = readFileSync(new URL('./fixtures/vouchers-export.xml', import.meta.url), 'utf8');

describe('the requests sent to Tally', () => {
  it('asks for one AlterID window of vouchers, escaping the company name', () => {
    const request = vouchersPageRequest('Shakti <Supreme> & Co', 4170, 4370, {
      from: '20240401',
      to: '20271231',
    });
    expect(request).toContain(
      '<SVCURRENTCOMPANY>Shakti &lt;Supreme&gt; &amp; Co</SVCURRENTCOMPANY>',
    );
    expect(request).toContain('$ALTERID &gt; 4170 AND $ALTERID &lt;= 4370');
    expect(request).toContain('<SVFROMDATE TYPE="Date">20240401</SVFROMDATE>');
    expect(vouchersPageRequest('C', 4170)).toContain('$ALTERID &gt; 4170</SYSTEM>');
    expect(() => vouchersPageRequest('C', -1)).toThrow();
    expect(() => vouchersPageRequest('C', 0, 1.5)).toThrow();
    expect(() => vouchersPageRequest('C', 0, 10, { from: '2024-04-01', to: '20271231' })).toThrow();
  });

  it('asks for party ledgers, the GUID snapshot and the company state the same way', () => {
    expect(ledgersPageRequest('C', 10, 20)).toContain('$$IsBelongsTo:$$GroupSundryDebtors');
    expect(ledgersPageRequest('C', 10, 20)).toContain('$ALTERID &gt; 10 AND $ALTERID &lt;= 20');
    expect(voucherGuidsRequest('C')).toContain('<FETCH>GUID, DATE, ALTERID, VOUCHERTYPENAME</FETCH>');
    expect(voucherGuidsRequest('C', { after: 0, upTo: 5000 })).toContain('$ALTERID &lt;= 5000');
    expect(companyStatusRequest('C')).toContain('ALTVCHID, ALTMSTID');
  });

  it('only ever exports: no request can change Tally', () => {
    const requests = [
      companyStatusRequest('C'),
      vouchersPageRequest('C', 0, 200),
      ledgersPageRequest('C', 0, 200),
      voucherGuidsRequest('C', { after: 0, upTo: 200 }),
    ];
    for (const request of requests) {
      expect(request).toContain('<TALLYREQUEST>Export</TALLYREQUEST>');
      expect(request).toContain('ISMODIFY="No"');
      expect(request).not.toMatch(/Import|ACTION="(?:Create|Alter|Delete)"/i);
    }
  });
});

describe('reading Tally answers', () => {
  it('reads vouchers into the contract shape, skipping a journal and one without a GUID', () => {
    const vouchers = parseVoucherExport(xml);
    expect(vouchers).toEqual([
      {
        guid: GUID_A,
        alterId: 4180,
        type: 'sales',
        typeName: 'Sales',
        voucherNo: 'SS/2026-27/0418',
        date: '2026-09-27',
        partyName: 'Kisan Agro Traders & Sons',
        partyGstin: '08AAAAA0000A1Z5',
        buyerOrderNo: 'SS/SO/2026-27/0042',
        amount: '126500.00',
        isCancelled: false,
        isOptional: false,
        ledgerEntries: [
          { ledgerName: 'Kisan Agro Traders & Sons', amount: '-126500.00' },
          { ledgerName: 'Sales GST 18%', amount: '107203.39' },
        ],
        inventoryEntries: [
          {
            stockItemName: 'Submersible pump 5 HP',
            quantity: '2',
            unit: 'Nos',
            rate: '53601.69',
            amount: '107203.39',
          },
        ],
      },
      {
        guid: GUID_B,
        alterId: 4175,
        type: 'receipt',
        typeName: 'Receipt',
        voucherNo: 'RC/0311',
        date: '2026-09-27',
        partyName: 'Kisan Agro Traders & Sons',
        partyGstin: null,
        buyerOrderNo: null,
        amount: '50000.00',
        isCancelled: true,
        isOptional: false,
        ledgerEntries: [{ ledgerName: 'Kisan Agro Traders & Sons', amount: '50000.00' }],
        inventoryEntries: [],
      },
    ]);
    const ordered = [...vouchers].sort((a, b) => Number(a.alterId) - Number(b.alterId));
    expect(
      ConnectorBatchRequest.safeParse({
        company: 'C',
        entityCode: 'SS',
        fromAlterId: 4170,
        maxAlterId: 4180,
        vouchers: ordered,
        ledgers: [],
      }).success,
    ).toBe(true);
    expect(parseGuidExport(xml)).toHaveLength(3);
  });

  it('maps Tally type names, preferring the parent of a renamed type', () => {
    expect(voucherTypeOf('Sales')).toBe('sales');
    expect(voucherTypeOf(' Credit  Note ')).toBe('credit_note');
    expect(voucherTypeOf('Debit Note')).toBe('debit_note');
    expect(voucherTypeOf('Journal')).toBeUndefined();
    const renamed = xml
      .replace('<VOUCHERTYPENAME TYPE="String">Sales</VOUCHERTYPENAME>', '<VOUCHERTYPENAME TYPE="String">Sales GST</VOUCHERTYPENAME><BOSBASETYPE TYPE="String">Sales</BOSBASETYPE>');
    expect(parseVoucherExport(renamed)[0]).toMatchObject({ type: 'sales', typeName: 'Sales GST' });
  });

  it('reads party ledgers with their GST registration and signed balances', () => {
    const answer = [
      '<ENVELOPE><BODY><DATA><COLLECTION>',
      '<LEDGER NAME="Kisan Agro Traders &amp; Sons" RESERVEDNAME="">',
      '<GUID TYPE="String">5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000b01</GUID>',
      '<ALTERID TYPE="Number"> 4190</ALTERID>',
      '<PARENT TYPE="String">Sundry Debtors</PARENT>',
      '<OPENINGBALANCE TYPE="Amount">-1,200.50</OPENINGBALANCE>',
      '<CLOSINGBALANCE TYPE="Amount">-76500.00</CLOSINGBALANCE>',
      '<NAME.LIST TYPE="String"><NAME>Kisan Agro Traders &amp; Sons</NAME></NAME.LIST>',
      '<LEDGSTREGDETAILS.LIST><GSTIN TYPE="String">08aaaaa0000a1z5</GSTIN></LEDGSTREGDETAILS.LIST>',
      '</LEDGER>',
      '<LEDGER NAME="No GUID"><ALTERID> 4191</ALTERID></LEDGER>',
      '</COLLECTION></DATA></BODY></ENVELOPE>',
    ].join('');
    const ledgers = parseLedgerExport(answer, '2026-11-27');
    expect(ledgers).toEqual([
      {
        guid: '5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000b01',
        alterId: 4190,
        name: 'Kisan Agro Traders & Sons',
        parent: 'Sundry Debtors',
        gstin: '08AAAAA0000A1Z5',
        openingBalance: '-1200.50',
        closingBalance: '-76500.00',
        asOf: '2026-11-27',
      },
    ]);
    expect(TallyLedger.safeParse(ledgers[0]).success).toBe(true);
  });

  it('reads the company state, and nothing for a company Tally does not have open', () => {
    const answer = [
      '<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="Shakti Supreme">',
      '<BOOKSFROM TYPE="Date">20240401</BOOKSFROM>',
      '<ALTVCHID TYPE="Number"> 5120</ALTVCHID><ALTMSTID TYPE="Number"> 5203</ALTMSTID>',
      '<BOSTALLYVERSION TYPE="String">TallyPrime 5.1</BOSTALLYVERSION>',
      '</COMPANY></COLLECTION></DATA></BODY></ENVELOPE>',
    ].join('');
    expect(parseCompanyStatus(answer)).toEqual({
      lastAlterId: 5203,
      booksFrom: '20240401',
      tallyVersion: 'TallyPrime 5.1',
    });
    expect(parseCompanyStatus('<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>')).toBeUndefined();
  });

  it('reads the snapshot with each voucher type, so journals can be left out', () => {
    const readings = parseGuidReadings(xml);
    expect(readings.map((r) => [r.guid.slice(-4), r.type, r.date])).toEqual([
      ['0a11', 'sales', '2026-09-27'],
      ['0a12', 'receipt', '2026-09-27'],
      ['0a14', undefined, undefined],
    ]);
  });

  it('reads a UTF-16 answer and drops characters XML does not allow', () => {
    const text = '<ENVELOPE><NAME>&#4; Kisan\u0004 Agro</NAME></ENVELOPE>';
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(decodeTallyAnswer(utf16)).toBe('<ENVELOPE><NAME> Kisan Agro</NAME></ENVELOPE>');
    expect(decodeTallyAnswer(Buffer.from(text, 'utf8'))).toBe(
      '<ENVELOPE><NAME> Kisan Agro</NAME></ENVELOPE>',
    );
  });

  it('tells an error answer from data', () => {
    expect(tallyAnswerProblem('<RESPONSE>Unknown Request, cannot be processed</RESPONSE>')).toBe(
      'unknown_request',
    );
    expect(
      tallyAnswerProblem('<ENVELOPE><BODY><DATA><LINEERROR>Could not set</LINEERROR></DATA></BODY></ENVELOPE>'),
    ).toBe('line_error');
    expect(tallyAnswerProblem(xml)).toBeUndefined();
  });
});
