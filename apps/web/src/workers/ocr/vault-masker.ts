import { DomainError } from '@shakti/contracts';
import { createDocumentMasker, type DocumentMasker } from './mask-document';

let opened: Promise<DocumentMasker> | undefined;

/**
 * The masking step the file checks use for vault photos and PDF pages, opened on first use and
 * kept for the process. It reads the English OCR model from the local folder `OCR_LANG_PATH`
 * names, never from the internet; without the folder it answers `integration_unavailable`, so
 * the checks are delivered again once it is set (docs/04-architecture-appendix/ocr.md).
 */
/** Whether a masking step is set up here; where it is not, vault photos and PDFs are refused. */
export function maskingConfigured(): boolean {
  const langPath = process.env.OCR_LANG_PATH;
  return langPath !== undefined && langPath !== '';
}

/**
 * Closes the masking step and forgets it, so the next use opens a new one. Used when a page ran
 * out of time: the engine is still busy with it and would hold up every check after it.
 */
export async function discardVaultMasker(): Promise<void> {
  const current = opened;
  opened = undefined;
  if (current === undefined) return;
  await (await current.catch(() => undefined))?.close();
}

export function vaultMasker(): Promise<DocumentMasker> {
  const langPath = process.env.OCR_LANG_PATH;
  if (langPath === undefined || langPath === '') {
    return Promise.reject(
      new DomainError('integration_unavailable', 'the masking step is not set up here'),
    );
  }
  opened ??= createDocumentMasker({ langPath }).catch((error: unknown) => {
    opened = undefined;
    throw error;
  });
  return opened;
}
