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
 * Closes the masking step `used`, the one a page ran out of time on, and forgets it when it is
 * still the current one, so the next use opens a new one. A newer masking step, opened since, is
 * left alone: an older page's timeout never closes what other checks are using. Closing answers
 * every mask still waiting on `used`.
 */
export async function discardVaultMasker(used: DocumentMasker): Promise<void> {
  const pending = opened;
  const current = await pending?.catch(() => undefined);
  if (pending !== undefined && current === used && opened === pending) opened = undefined;
  await used.close();
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
