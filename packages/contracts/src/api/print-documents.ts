import { z } from 'zod';

/**
 * Documents rendered to A4 PDFs from their HTML templates (ADR 0009). A type renders once its
 * loader is registered in `apps/web/src/print/documents.ts`; `company_letterhead_proof` is a
 * company's one-page proof of its letterhead, logo, address, GSTIN and bank details.
 */
export const PDF_DOCUMENT_TYPES = [
  'quote',
  'proforma',
  'delivery_challan',
  'handover_kit',
  'company_letterhead_proof',
] as const;
export const PdfDocumentTypeSchema = z.enum(PDF_DOCUMENT_TYPES);
export type PdfDocumentType = z.infer<typeof PdfDocumentTypeSchema>;
