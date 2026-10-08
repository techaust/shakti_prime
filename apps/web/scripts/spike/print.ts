// Print spike (ROADMAP §2 week 6): `pnpm spike:print`.
// Renders a 1-page and a 5-page A4 quotation and 100 QR labels in two sizes with headless
// Chromium, checks the output (page counts, Inter embedded, rupee sign drawn in Inter, text
// present, the QR code's printed modules match its payload) and measures cold start and
// per-page and per-label times. Writes docs/04-architecture-appendix/results/print.json and the PDFs and PNGs
// to apps/web/.spike-output/print/. Needs `pnpm --filter web exec playwright-core install
// chromium-headless-shell` once.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { spikeLabels, spikeQuote } from '../../src/print/fixtures/spike-documents';
import { formatRupees } from '../../src/print/format';
import { renderLabelsHtml, type LabelSize } from '../../src/print/label-template';
import { qrMatrix } from '../../src/print/qr';
import { renderQuote } from '../../src/print/quote-template';
import { createPrintRenderer, pageCount } from '../../src/print/renderer';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..', '..');
const repoRoot = resolve(webRoot, '..', '..');
const outDir = join(webRoot, '.spike-output', 'print');
const resultFile = join(repoRoot, 'docs', '04-architecture-appendix', 'results', 'print.json');

const WARM_RUNS = 5;
const LABELS = 100;
const SINGLE_LABEL_RUNS = 20;

function embeddedFonts(pdf: Buffer): string[] {
  // Chromium subsets each font instance and names it "ABCDEF+Inter-SemiBold".
  const names = pdf.toString('latin1').match(/\/FontName\s*\/[A-Za-z0-9+_-]+/g) ?? [];
  return [...new Set(names.map((n) => n.replace(/\/FontName\s*\/([A-Z]{6}\+)?/, '')))];
}

/** Font programs and text maps: every font needs a map for the text to be searchable. */
function fontStats(pdf: Buffer): { type3: number; fonts: number; toUnicode: number } {
  const text = pdf.toString('latin1');
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  return {
    type3: count(/\/Subtype\s*\/Type3/g),
    fonts: count(/\/Type\s*\/Font(?![a-zA-Z])/g),
    toUnicode: count(/\/ToUnicode/g),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0);
}

const checks: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'pass' : 'FAIL'}  ${name}: ${detail}`);
}

/** Samples the centre of every module of a QR screenshot and compares it with the payload. */
async function qrMatches(png: Buffer, payload: string): Promise<{ ok: boolean; wrong: number }> {
  const matrix = qrMatrix(payload);
  const size = matrix.length;
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  let wrong = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = Math.floor(((x + 0.5) / size) * info.width);
      const py = Math.floor(((y + 0.5) / size) * info.height);
      const dark = (data[py * info.width + px] ?? 255) < 128;
      if (dark !== matrix[y]?.[x]) wrong += 1;
    }
  }
  return { ok: wrong === 0, wrong };
}

/** Text, font and glyph checks in the rendered page, before it is printed. */
async function domChecks(page: string, expectText: string[]) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ offline: true, colorScheme: 'light' });
    const tab = await context.newPage();
    await tab.setContent(page, { waitUntil: 'load' });
    await tab.evaluate(async () => {
      await document.fonts.ready;
    });
    const text = await tab.innerText('body');
    const rupeeInInter = await tab.evaluate(() => document.fonts.check('13px Inter', '₹'));
    const background = await tab.evaluate(() => getComputedStyle(document.body).backgroundColor);
    return {
      missing: expectText.filter((t) => !text.includes(t)),
      rupeeInInter,
      background,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dirname(resultFile), { recursive: true });

  // Cold start: launching the browser, then the first document through it.
  const launchStarted = performance.now();
  const renderer = await createPrintRenderer();
  const launchMs = performance.now() - launchStarted;

  const onePage = await renderQuote(spikeQuote(1));
  const firstStarted = performance.now();
  const firstPdf = await renderer.renderPdf(onePage.html, onePage.options);
  const firstRenderMs = performance.now() - firstStarted;

  // Warm renders.
  const oneTimes: number[] = [];
  let onePdf = firstPdf;
  for (let i = 0; i < WARM_RUNS; i++) {
    const t = performance.now();
    onePdf = await renderer.renderPdf(onePage.html, onePage.options);
    oneTimes.push(performance.now() - t);
  }
  // The smallest quotation (in whole kits of seven lines) that fills five A4 pages.
  let sites = 6;
  let fivePage = await renderQuote(spikeQuote(sites));
  while (sites < 20 && pageCount(await renderer.renderPdf(fivePage.html, fivePage.options)) < 5) {
    sites += 1;
    fivePage = await renderQuote(spikeQuote(sites));
  }
  const fiveTimes: number[] = [];
  let fivePdf: Buffer = Buffer.alloc(0);
  for (let i = 0; i < WARM_RUNS; i++) {
    const t = performance.now();
    fivePdf = await renderer.renderPdf(fivePage.html, fivePage.options);
    fiveTimes.push(performance.now() - t);
  }
  writeFileSync(join(outDir, 'quote-1-page.pdf'), onePdf);
  writeFileSync(join(outDir, 'quote-5-pages.pdf'), fivePdf);

  const labels = spikeLabels(LABELS);
  const labelResults: Record<string, unknown> = {};
  for (const size of ['50x25', '100x50'] as LabelSize[]) {
    const batchHtml = await renderLabelsHtml(labels, size);
    const batchStarted = performance.now();
    const batchPdf = await renderer.renderLabel(batchHtml, size);
    const batchMs = performance.now() - batchStarted;
    writeFileSync(join(outDir, `labels-${size}-x${LABELS}.pdf`), batchPdf);

    const singleTimes: number[] = [];
    for (let i = 0; i < SINGLE_LABEL_RUNS; i++) {
      const one = await renderLabelsHtml(labels.slice(i, i + 1), size);
      const t = performance.now();
      await renderer.renderLabel(one, size);
      singleTimes.push(performance.now() - t);
    }

    const firstLabel = labels[0];
    const png = await renderer.renderImage(
      await renderLabelsHtml(firstLabel ? [firstLabel] : [], size),
      '.qr svg',
      300,
    );
    writeFileSync(join(outDir, `label-${size}-qr-300dpi.png`), png);
    const labelPng = await renderer.renderImage(
      await renderLabelsHtml(firstLabel ? [firstLabel] : [], size),
      '.label',
      203,
    );
    writeFileSync(join(outDir, `label-${size}-203dpi.png`), labelPng);
    const qr = await qrMatches(png, firstLabel?.qrPayload ?? '');

    check(
      `labels ${size}: one page per label`,
      pageCount(batchPdf) === LABELS,
      `${pageCount(batchPdf)} pages`,
    );
    check(
      `labels ${size}: QR modules match the payload at 300 dpi`,
      qr.ok,
      `${qr.wrong} modules differ`,
    );
    labelResults[size] = {
      labels: LABELS,
      batchMs: Math.round(batchMs),
      batchPerLabelMs: Math.round((batchMs / LABELS) * 10) / 10,
      batchBytes: batchPdf.length,
      singleLabelMedianMs: median(singleTimes),
      qrModulesWrong: qr.wrong,
    };
  }

  const quoteQr = await renderer.renderImage(onePage.html, '.qr svg', 300);
  writeFileSync(join(outDir, 'quote-qr-300dpi.png'), quoteQr);
  const quoteQrCheck = await qrMatches(quoteQr, spikeQuote(1).link);
  const quotePng = await renderer.renderImage(onePage.html, 'body', 96);
  writeFileSync(join(outDir, 'quote-1-page-96dpi.png'), quotePng);
  await renderer.close();

  const onePages = pageCount(onePdf);
  const fivePages = pageCount(fivePdf);
  check('1-page quotation has one page', onePages === 1, `${onePages} page(s)`);
  check('5-page quotation has five pages', fivePages === 5, `${fivePages} page(s)`);
  const fonts = embeddedFonts(onePdf);
  check(
    'Inter is embedded in the PDF',
    fonts.some((f) => f.includes('Inter')),
    fonts.join(', '),
  );
  check(
    'no other font is embedded',
    fonts.every((f) => f.includes('Inter')),
    fonts.join(', '),
  );
  check(
    'quotation QR modules match the payload at 300 dpi',
    quoteQrCheck.ok,
    `${quoteQrCheck.wrong} modules differ`,
  );
  const stats = fontStats(onePdf);
  check(
    'every font has a text map, so the PDF text can be searched and copied',
    stats.toUnicode >= stats.fonts,
    `${stats.toUnicode} maps for ${stats.fonts} fonts (${stats.type3} drawn as Type 3)`,
  );

  const q = spikeQuote(1);
  const dom = await domChecks(onePage.html, [
    q.number,
    q.customer.name,
    '27-09-2026',
    '27-10-2026',
    formatRupees(q.totals.total),
    q.totals.totalInWords,
  ]);
  check(
    'quotation text present',
    dom.missing.length === 0,
    dom.missing.length ? `missing ${dom.missing.join(' | ')}` : 'all present',
  );
  check('rupee sign drawn in Inter', dom.rupeeInInter, String(dom.rupeeInInter));
  check('light background', dom.background === 'rgb(255, 255, 255)', dom.background);

  const summary = {
    ranAt: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}, Node ${process.version}`,
    chromium: 'playwright-core 1.63, chromium-headless-shell',
    coldStart: {
      launchMs: Math.round(launchMs),
      firstRenderMs: Math.round(firstRenderMs),
      totalMs: Math.round(launchMs + firstRenderMs),
    },
    quote1Page: {
      pages: onePages,
      medianMs: median(oneTimes),
      bytes: onePdf.length,
    },
    quote5Pages: {
      pages: fivePages,
      lines: spikeQuote(sites).lines.length,
      medianMs: median(fiveTimes),
      perPageMs: Math.round(median(fiveTimes) / Math.max(1, fivePages)),
      bytes: fivePdf.length,
    },
    labels: labelResults,
    fonts,
    fontPrograms: fontStats(onePdf),
    checks,
  };
  writeFileSync(resultFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, checks: undefined }, null, 2));
  if (checks.some((c) => !c.pass)) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
