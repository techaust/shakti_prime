import { newId, type PdfRenderJob } from '@shakti/contracts';
import {
  envelopeCipher,
  localKeyProvider,
  sealBankDetails,
  type CompanyForPrint,
  type EntityRow,
  type FileStore,
  type StoredFile,
} from '@shakti/domain';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { companyPrintOf, DOCUMENT_TYPES, documentType, proformaPrintOf } from './documents';
import { spikeCompany } from './fixtures/spike-documents';

const cipher = envelopeCipher(localKeyProvider(randomBytes(32).toString('base64')));
const ACCOUNT = {
  bankName: 'State Bank of India',
  accountNumber: '30187264519',
  ifsc: 'SBIN0011528',
  branch: 'Sitapura, Jaipur',
};

function entity(id: number, overrides: Partial<EntityRow> = {}): EntityRow {
  return {
    id,
    code: `C${String(id)}`,
    legalName: `Company ${String(id)} Private Limited`,
    brandName: `Company ${String(id)}`,
    gstin: '08AAKFA4821M1Z3',
    stateCode: '08',
    upiId: null,
    addressLine1: 'Plot 14, Sitapura Industrial Area',
    addressLine2: null,
    city: 'Jaipur',
    pin: '302022',
    bankDetailsSet: false,
    archivedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function file(entityId: number, purpose: 'entity_logo' | 'letterhead', contentType: string) {
  const id = newId();
  return {
    id,
    entityId,
    purpose,
    bucket: 'local',
    key: `${String(entityId)}/${purpose}/${id}.png`,
    name: 'logo.png',
    contentType,
    size: 3,
    sha256: 'a'.repeat(64),
    status: 'ready',
    createdBy: newId(),
    originalKey: undefined,
    deletedAt: null,
  } satisfies StoredFile;
}

/** A store holding the given keys, answering three bytes for each. */
function store(keys: readonly string[]): FileStore {
  const held = new Set(keys);
  return {
    bucket: 'local',
    scanned: false,
    put: () => Promise.resolve(),
    get: (key) => Promise.resolve(held.has(key) ? new Uint8Array([1, 2, 3]) : undefined),
    presignPut: () => Promise.reject(new Error('not here')),
    presignGet: () => Promise.reject(new Error('not here')),
    head: () => Promise.resolve(undefined),
    tags: () => Promise.resolve({}),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ keys: [] }),
  };
}

describe('the selling company as the templates print it', () => {
  it('prints the address lines that are set, the images the store holds and the opened account', async () => {
    const logo = file(3, 'entity_logo', 'image/png');
    const letterhead = file(3, 'letterhead', 'image/webp');
    const read: CompanyForPrint = {
      entity: entity(3, { addressLine2: 'Near the water tank' }),
      logo,
      letterhead,
      sealedBank: await sealBankDetails(cipher, 3, ACCOUNT),
    };
    const company = await companyPrintOf(read, {
      store: store([logo.key, letterhead.key]),
      cipher,
      entityId: 3,
    });
    expect(company).toEqual({
      legalName: 'Company 3 Private Limited',
      brandName: 'Company 3',
      addressLines: ['Plot 14, Sitapura Industrial Area', 'Near the water tank', 'Jaipur 302022'],
      gstin: '08AAKFA4821M1Z3',
      logo: { contentType: 'image/png', base64: 'AQID' },
      letterhead: { contentType: 'image/webp', base64: 'AQID' },
      bank: ACCOUNT,
    });
  });

  it('leaves out what is not recorded, and a picture the store no longer holds', async () => {
    const logo = file(3, 'entity_logo', 'image/png');
    const company = await companyPrintOf(
      {
        entity: entity(3, { addressLine1: null, city: null, pin: null, gstin: null }),
        logo,
        letterhead: undefined,
        sealedBank: null,
      },
      { store: store([]), cipher: undefined, entityId: 3 },
    );
    expect(company).toMatchObject({
      addressLines: [],
      gstin: null,
      logo: null,
      letterhead: null,
      bank: null,
    });
  });

  it('never prints another company: its details, or an account sealed for another company', async () => {
    await expect(
      companyPrintOf(
        { entity: entity(4), logo: undefined, letterhead: undefined, sealedBank: null },
        { store: store([]), cipher, entityId: 3 },
      ),
    ).rejects.toMatchObject({ code: 'internal' });
    await expect(
      companyPrintOf(
        {
          entity: entity(3),
          logo: undefined,
          letterhead: undefined,
          sealedBank: await sealBankDetails(cipher, 4, ACCOUNT),
        },
        { store: store([]), cipher, entityId: 3 },
      ),
    ).rejects.toMatchObject({ code: 'integration_unavailable' });
  });

  it('is unavailable without a field cipher when an account is recorded', async () => {
    await expect(
      companyPrintOf(
        {
          entity: entity(3),
          logo: undefined,
          letterhead: undefined,
          sealedBank: await sealBankDetails(cipher, 3, ACCOUNT),
        },
        { store: store([]), cipher: undefined, entityId: 3 },
      ),
    ).rejects.toMatchObject({ code: 'integration_unavailable' });
  });
});

describe('the document registry', () => {
  it('prints the company proof page, under its own purpose, as the file the screen waits for', () => {
    const registered = documentType('company_letterhead_proof');
    expect(registered?.purpose).toBe('print_proof');
    const documentId = newId();
    const job: PdfRenderJob = {
      eventId: newId(),
      entityId: 1,
      target: {
        kind: 'document',
        documentType: 'company_letterhead_proof',
        documentId,
        version: 1,
      },
    };
    if (job.target.kind !== 'document') throw new Error('a document job');
    expect(registered?.fileId(job, job.target)).toBe(documentId);
  });

  it('prints the proof page, the quote and the proforma, and has no loader yet for any other document', () => {
    expect(Object.keys(DOCUMENT_TYPES)).toEqual(['company_letterhead_proof', 'quote', 'proforma']);
    expect(documentType('quote')?.purpose).toBe('quote_pdf');
    expect(documentType('proforma')?.purpose).toBe('proforma_pdf');
    expect(documentType('delivery_challan')).toBeUndefined();
  });
});

describe('a proforma as the template prints it (FN1)', () => {
  const read = {
    id: newId(),
    entityId: 3,
    proformaNo: 'ASH/PI/2026-27/0001',
    state: 'issued' as const,
    createdAt: '2026-09-28T20:00:00.000Z',
    soNo: 'ASH/SO/2026-27/0007',
    placeOfSupplyState: '08',
    supplyKind: 'intra' as const,
    subtotal: '1000.00',
    cgst: '90.00',
    sgst: '90.00',
    igst: '0.00',
    roundOff: '0.00',
    grandTotal: '1180.00',
    customerName: 'A customer',
    customerGstin: null,
    site: null,
    preparedBy: 'Accounts',
    lines: [
      {
        position: 1,
        sku: 'SKU-1',
        description: 'An item',
        unit: 'nos' as const,
        qty: '2.000',
        unitPrice: '500.00',
        hsn: '8413',
        taxRatePct: '18.00',
        goodsRatePct: null,
        servicesRatePct: null,
        taxableValue: '1000.00',
        cgst: '90.00',
        sgst: '90.00',
        igst: '0.00',
      },
    ],
    milestones: [
      {
        label: 'Advance',
        amount: '590.00',
        dueRule: 'on_confirmation' as const,
        dueDays: null,
        state: 'due' as const,
      },
      {
        label: 'Waived',
        amount: '100.00',
        dueRule: 'on_installation' as const,
        dueDays: null,
        state: 'waived' as const,
      },
      {
        label: 'Balance',
        amount: '490.00',
        dueRule: 'days_after_invoice' as const,
        dueDays: 30,
        state: 'pending' as const,
      },
    ],
  };

  it('places the amounts as the proforma holds them, its date in India, and the payments not waived', () => {
    const printed = proformaPrintOf(read, spikeCompany(), 'company@upi');
    expect(printed).toMatchObject({
      number: read.proformaNo,
      orderNumber: read.soNo,
      date: '2026-09-29',
      upiId: 'company@upi',
      cancelled: false,
      totals: {
        taxable: '1000.00',
        taxes: [
          { tax: 'CGST', amount: '90.00' },
          { tax: 'SGST', amount: '90.00' },
        ],
        rounding: '0.00',
        total: '1180.00',
      },
    });
    expect(printed.lines[0]).toMatchObject({
      quantity: '2',
      rate: '500.00',
      amount: '1000.00',
      hsn: '8413',
    });
    expect(printed.payments).toEqual([
      { label: 'Advance', due: 'On confirmation', amount: '590.00' },
      { label: 'Balance', due: '30 days after the invoice', amount: '490.00' },
    ]);
  });

  it('prints IGST alone across states', () => {
    const printed = proformaPrintOf(
      { ...read, supplyKind: 'inter', cgst: '0.00', sgst: '0.00', igst: '180.00' },
      spikeCompany(),
      null,
    );
    expect(printed.totals.taxes).toEqual([{ tax: 'IGST', amount: '180.00' }]);
  });
});
