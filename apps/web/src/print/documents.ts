// The document types the render worker prints (ADR 0009, docs/03-roadmap-appendix/phase1.md §6.4). Each type
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
  attachQuotePdf,
  executeCommand,
  executeQuery,
  loadCompanyForPrint,
  loadQuoteForPrint,
  openBankDetails,
  type CompanyForPrint,
  type FieldCipher,
  type FileStore,
  type QuoteForPrint,
  type StoredFile,
} from '@shakti/domain';
import type { CompanyPrint, PrintImage } from './company';
import { printCopy, type PrintCopy } from './copy';
import { formatDate, istDay } from './format';
import { renderLetterheadProof, type LetterheadProofPrint } from './letterhead-proof-template';
import { renderQuote, type PrintDocument, type QuotePrint } from './quote-template';
import { rupeesInWords } from './words';

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

/** What an attach step is given: the worker principal of the job's company and the runtime. */
export interface AttachContext {
  principal: Principal;
  entityId: number;
  requestId: string;
  hosted: boolean;
}

export interface DocumentType<D> {
  purpose: RenderedFilePurpose;
  /** The id of the file a job of this type records. */
  fileId: (job: PdfRenderJob, target: DocumentTarget) => string;
  /** What a person sees the file called when they open it. */
  fileName: (data: D) => string;
  load: (target: DocumentTarget, ctx: LoadContext) => Promise<D>;
  render: (data: D) => Promise<PrintDocument> | PrintDocument;
  /**
   * Attaches the recorded file to the document's own record, for a document that has one (a
   * quote's PDF on the quote); run after the file is recorded, again on a delivery that runs
   * again, so it must change nothing the second time.
   */
  attach?: (target: DocumentTarget, fileId: string, ctx: AttachContext) => Promise<void>;
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

/** A quote's site as the customer block prints it: the street, the village and the district. */
function siteLines(site: QuoteForPrint['site']): string[] {
  if (site === null) return [];
  const join = (parts: (string | null)[]) =>
    parts.filter((p): p is string => p !== null && p !== '').join(', ');
  return [
    join([site.address]),
    join([site.village, site.tehsil]),
    join([site.district, site.pin]),
  ].filter((line) => line !== '');
}

/** A GST rate as the line prints it: its own rate, or the goods and services rates of a split. */
function lineRate(line: QuoteForPrint['lines'][number], t: PrintCopy): string {
  if (line.taxRatePct !== null) return t('quote.gstRate', { rate: Number(line.taxRatePct) });
  return t('quote.gstComposite', {
    goods: Number(line.goodsRatePct ?? '0'),
    services: Number(line.servicesRatePct ?? '0'),
  });
}

/** A stored quantity as printed: `5.000` becomes `5`. */
const plainQty = (qty: string) => (qty.includes('.') ? qty.replace(/\.?0+$/, '') : qty);

/**
 * A quote as the quotation template prints it (docs/03-roadmap-appendix/phase1.md §7.3): the amounts exactly as
 * the quote holds them, priced by the Price Master and taxed by the engine when it was made; this
 * only places and words them. The place of supply is the state's name and code; the terms say
 * until when the prices hold. No phone number is printed, and no QR code until customers have a
 * page to open (Phase 2).
 */
export function quotePrintOf(quote: QuoteForPrint, company: CompanyPrint): QuotePrint {
  const t = printCopy();
  const stateKey = `states.${quote.placeOfSupplyState}` as 'states.08';
  const validUntil = istDay(new Date(quote.validUntil));
  const intra = quote.supplyKind === 'intra';
  return {
    company,
    number: quote.quoteNo,
    date: istDay(new Date(quote.createdAt)),
    validUntil,
    customer: {
      name: quote.customerName,
      addressLines: siteLines(quote.site),
      ...(quote.customerGstin === null ? {} : { gstin: quote.customerGstin }),
      placeOfSupply: t.has(stateKey)
        ? t('quote.placeOfSupplyState', {
            state: t(stateKey),
            code: quote.placeOfSupplyState,
          })
        : quote.placeOfSupplyState,
    },
    lines: quote.lines.map((line) => ({
      description: line.description,
      detail: line.sku,
      hsn: line.hsn ?? '',
      quantity: plainQty(line.qty),
      unit: t(`quote.units.${line.unit}`),
      rate: line.unitPrice,
      gstRate: lineRate(line, t),
      amount: line.taxableValue,
    })),
    totals: {
      taxable: quote.subtotal,
      taxes: intra
        ? [
            { tax: 'CGST', amount: quote.cgst },
            { tax: 'SGST', amount: quote.sgst },
          ]
        : [{ tax: 'IGST', amount: quote.igst }],
      rounding: quote.roundOff,
      total: quote.grandTotal,
      totalInWords: rupeesInWords(quote.grandTotal, t),
    },
    terms: [t('quote.termValidity', { date: formatDate(validUntil) })],
    preparedBy: quote.preparedBy ?? '',
  };
}

const quoteDocument: DocumentType<QuotePrint> = {
  purpose: 'quote_pdf',
  // One file per request to print: a delivery that runs again finds the file it recorded.
  fileId: (job) => job.eventId,
  fileName: (data) => printCopy()('quote.fileName', { number: data.number.replaceAll('/', '-') }),
  load: async (target, ctx) => {
    const quote = await executeQuery(
      ctx.principal,
      { entityIds: [ctx.entityId], requestId: ctx.requestId },
      (q) => loadQuoteForPrint(q, target.documentId),
      { name: 'print.quote.load' },
    );
    if (quote.entityId !== ctx.entityId) {
      throw new DomainError('internal', 'the print loader read another company');
    }
    return quotePrintOf(quote, await loadCompanyPrint(ctx));
  },
  render: (data) => renderQuote(data),
  attach: async (target, fileId, ctx) => {
    await executeCommand(
      ctx.principal,
      { entityIds: [ctx.entityId], requestId: ctx.requestId },
      attachQuotePdf,
      { entityId: ctx.entityId, quoteId: target.documentId, fileId },
      { hosted: ctx.hosted },
    );
  },
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
  attach?: (target: DocumentTarget, fileId: string, ctx: AttachContext) => Promise<void>;
}

function register<D>(type: DocumentType<D>): RegisteredDocument {
  return {
    purpose: type.purpose,
    fileId: type.fileId,
    async print(target, ctx) {
      const data = await type.load(target, ctx);
      return { document: await type.render(data), fileName: type.fileName(data) };
    },
    ...(type.attach === undefined ? {} : { attach: type.attach }),
  };
}

/** The registered types: the proof page, and the quote with its record and attach command (S1). */
export const DOCUMENT_TYPES: Partial<Record<PdfDocumentType, RegisteredDocument>> = {
  company_letterhead_proof: register(letterheadProof),
  quote: register(quoteDocument),
};

/** The registered type of a job, or undefined for a type no loader prints yet. */
export function documentType(type: PdfDocumentType): RegisteredDocument | undefined {
  return Object.hasOwn(DOCUMENT_TYPES, type) ? DOCUMENT_TYPES[type] : undefined;
}
