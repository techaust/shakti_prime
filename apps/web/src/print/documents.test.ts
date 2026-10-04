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
import { companyPrintOf, DOCUMENT_TYPES, documentType } from './documents';

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
    originalKey: undefined,
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

  it('has no loader yet for a quote or any other document', () => {
    expect(Object.keys(DOCUMENT_TYPES)).toEqual(['company_letterhead_proof']);
    expect(documentType('quote')).toBeUndefined();
    expect(documentType('delivery_challan')).toBeUndefined();
  });
});
