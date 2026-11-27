import { printCopy } from './copy';

/** The file name a purchase order's PDF downloads as: its number with slashes as dashes. */
export function purchaseOrderPdfFileName(poNo: string): string {
  return printCopy()('purchaseOrder.fileName', { number: poNo.replaceAll('/', '-') });
}
