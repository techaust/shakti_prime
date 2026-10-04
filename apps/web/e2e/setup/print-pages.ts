// The print templates' own pages for the snapshot journey (`e2e/print.spec.ts`), written by the
// seed on the host: the templates read the message catalogue and the font files, which the
// Playwright runner does not load, so the spec opens these files instead. Fixed data only (the
// print spike's), with a logo and a letterhead in plain colours.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrintImage } from '../../src/print/company';
import { spikeCompany, spikeLabels, spikeQuote } from '../../src/print/fixtures/spike-documents';
import { renderLabelsHtml } from '../../src/print/label-template';
import { renderLetterheadProof } from '../../src/print/letterhead-proof-template';
import { renderQuote } from '../../src/print/quote-template';
import { solidPng } from '../support/png';

/** Where the pages go; `print.spec.ts` reads them by these names. */
export const PRINT_PAGES_DIR = join(import.meta.dirname, '..', '.print');
export const PRINT_PAGES = ['quote', 'proof', 'label-50x25', 'label-100x50'] as const;

const picture = (width: number, height: number, colour: [number, number, number]): PrintImage => ({
  contentType: 'image/png',
  base64: solidPng(width, height, colour).toString('base64'),
});

export async function writePrintPages(): Promise<void> {
  const company = spikeCompany({
    logo: picture(160, 160, [94, 106, 210]),
    letterhead: picture(1800, 200, [246, 246, 248]),
  });
  const pages: Record<(typeof PRINT_PAGES)[number], string> = {
    quote: (await renderQuote({ ...spikeQuote(1), company })).html,
    proof: renderLetterheadProof({ company, printedOn: '2026-10-04' }).html,
    'label-50x25': await renderLabelsHtml(spikeLabels(1), '50x25'),
    'label-100x50': await renderLabelsHtml(spikeLabels(1), '100x50'),
  };
  mkdirSync(PRINT_PAGES_DIR, { recursive: true });
  for (const name of PRINT_PAGES) writeFileSync(join(PRINT_PAGES_DIR, `${name}.html`), pages[name]);
}
