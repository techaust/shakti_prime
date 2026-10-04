// The document types the render worker prints (ADR 0009, docs/design/phase1.md §6.4). Each type
// names the purpose its PDF is stored under, the file id a job of it records (so a repeated
// delivery records one file), the loader that reads the document as the worker principal, the
// template that prints it, and, once the document has a record of its own (a quote, with S1), the
// command that attaches the PDF to it. A type with no entry here is refused by the worker.
import {
  DomainError,
  type PdfDocumentType,
  type PdfRenderJob,
  type Principal,
  type RenderedFilePurpose,
} from '@shakti/contracts';
import {
  executeQuery,
  loadCompanyForPrint,
  openBankDetails,
  type CompanyForPrint,
  type FieldCipher,
  type FileStore,
  type StoredFile,
} from '@shakti/domain';
import type { CompanyPrint, PrintImage } from './company';
import { printCopy } from './copy';
import { renderLetterheadProof, type LetterheadProofPrint } from './letterhead-proof-template';
import type { PrintDocument } from './quote-template';

/** A job's document: `kind: 'document'` of `PdfRenderJob`. */
export type DocumentTarget = Extract<PdfRenderJob['target'], { kind: 'document' }>;

/** What a loader is given: the worker principal of the job's company and the runtime's ports. */
export interface LoadContext {
  /** `system:workers` for the job's company alone (`files.process`). */
  principal: Principal;
  entityId: number;
  requestId: string;
  store: FileStore;
  /** Opens the company's bank account; without one, a company with an account is not printed. */
  cipher: FieldCipher | undefined;
  /** Today in IST, "YYYY-MM-DD". */
  today: string;
}

export interface DocumentType<D> {
  purpose: RenderedFilePurpose;
  /** The id of the file a job of this type records. */
  fileId: (job: PdfRenderJob, target: DocumentTarget) => string;
  /** What a person sees the file called when they open it. */
  fileName: (data: D) => string;
  load: (target: DocumentTarget, ctx: LoadContext) => Promise<D>;
  render: (data: D) => Promise<PrintDocument> | PrintDocument;
}

const IMAGE_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/webp']);

/** A stored logo or letterhead, inlined; a file the store no longer holds is left out. */
async function inlineImage(
  file: StoredFile | undefined,
  store: FileStore,
): Promise<PrintImage | null> {
  if (file === undefined || !IMAGE_TYPES.has(file.contentType)) return null;
  const bytes = await store.get(file.key);
  if (bytes === undefined) return null;
  return {
    contentType: file.contentType as PrintImage['contentType'],
    base64: Buffer.from(bytes).toString('base64'),
  };
}

/**
 * The selling company as the templates print it: read as the worker for the job's company only,
 * then the bank account opened and the images fetched outside the read's transaction.
 */
export async function loadCompanyPrint(ctx: LoadContext): Promise<CompanyPrint> {
  const read: CompanyForPrint = await executeQuery(
    ctx.principal,
    { entityIds: [ctx.entityId], requestId: ctx.requestId },
    (q) => loadCompanyForPrint(q, ctx.entityId),
    { name: 'print.company.load' },
  );
  return companyPrintOf(read, ctx);
}

/** `CompanyForPrint` as the templates print it (exported for the loader's tests). */
export async function companyPrintOf(
  read: CompanyForPrint,
  ctx: Pick<LoadContext, 'store' | 'cipher' | 'entityId'>,
): Promise<CompanyPrint> {
  const { entity } = read;
  if (entity.id !== ctx.entityId) {
    throw new DomainError('internal', 'the print loader read another company');
  }
  let bank: CompanyPrint['bank'] = null;
  if (read.sealedBank !== null) {
    if (ctx.cipher === undefined) {
      throw new DomainError('integration_unavailable', 'no field cipher to open the bank account');
    }
    try {
      bank = await openBankDetails(ctx.cipher, entity.id, read.sealedBank);
    } catch (error) {
      throw new DomainError(
        'integration_unavailable',
        'the bank account could not be opened',
        {},
        { cause: error },
      );
    }
  }
  const city = [entity.city, entity.pin].filter((part) => part !== null).join(' ');
  return {
    legalName: entity.legalName,
    brandName: entity.brandName,
    addressLines: [entity.addressLine1, entity.addressLine2, city === '' ? null : city].filter(
      (line): line is string => line !== null && line !== '',
    ),
    gstin: entity.gstin,
    logo: await inlineImage(read.logo, ctx.store),
    letterhead: await inlineImage(read.letterhead, ctx.store),
    bank,
  };
}

const letterheadProof: DocumentType<LetterheadProofPrint> = {
  purpose: 'print_proof',
  // The proof's id is its file's id: the screen that asked for it waits for that file.
  fileId: (_job, target) => target.documentId,
  fileName: (data) => printCopy()('proof.fileName', { name: data.company.brandName }),
  load: async (_target, ctx) => ({ company: await loadCompanyPrint(ctx), printedOn: ctx.today }),
  render: (data) => renderLetterheadProof(data),
};

/** A registered type, its data type hidden: what the worker calls. */
export interface RegisteredDocument {
  purpose: RenderedFilePurpose;
  fileId: (job: PdfRenderJob, target: DocumentTarget) => string;
  /** Loads the document and prints its template: the page and the file's name. */
  print: (
    target: DocumentTarget,
    ctx: LoadContext,
  ) => Promise<{ document: PrintDocument; fileName: string }>;
}

function register<D>(type: DocumentType<D>): RegisteredDocument {
  return {
    purpose: type.purpose,
    fileId: type.fileId,
    async print(target, ctx) {
      const data = await type.load(target, ctx);
      return { document: await type.render(data), fileName: type.fileName(data) };
    },
  };
}

/** The registered types; the quote joins with its record and attach command (S1). */
export const DOCUMENT_TYPES: Partial<Record<PdfDocumentType, RegisteredDocument>> = {
  company_letterhead_proof: register(letterheadProof),
};

/** The registered type of a job, or undefined for a type no loader prints yet. */
export function documentType(type: PdfDocumentType): RegisteredDocument | undefined {
  return Object.hasOwn(DOCUMENT_TYPES, type) ? DOCUMENT_TYPES[type] : undefined;
}
