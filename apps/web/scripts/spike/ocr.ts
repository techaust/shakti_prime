// OCR masking spike (ROADMAP §2 week 6): `pnpm spike:ocr`.
// Generates about thirty made-up document photos in memory, masks each one twice (as a photo
// of unknown kind, as from WhatsApp, and as an upload to a slot that says which number it
// carries), then reads each masked image again to check the hidden digits cannot be read
// back. Writes the numbers to docs/spikes/results/ocr.json and the masked images (only) to
// apps/web/.spike-output/ocr/. The unmasked photos never leave memory.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeOcrDigits } from '@shakti/domain';
import { createWorker, type Worker } from 'tesseract.js';
import {
  createDocumentMasker,
  type DocumentMasker,
  type MaskRequest,
} from '../../src/workers/ocr/mask-document';
import { generateDocuments, type SyntheticDocument } from './ocr-documents';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..', '..');
const repoRoot = resolve(webRoot, '..', '..');
const outDir = join(webRoot, '.spike-output', 'ocr');
const resultFile = join(repoRoot, 'docs', 'spikes', 'results', 'ocr.json');

// The language data lives outside the repository, like the Chromium build. It is fetched once
// from the tesseract.js default source; the masking worker itself never fetches it.
const langPath = join(
  process.env.LOCALAPPDATA ?? join(homedir(), '.cache'),
  'shakti-prime',
  'tesseract',
  '4.0.0_best_int',
);
const LANG_SOURCE =
  'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz';

async function ensureLanguageData(): Promise<void> {
  const file = join(langPath, 'eng.traineddata.gz');
  if (existsSync(file)) return;
  mkdirSync(langPath, { recursive: true });
  console.log(`Fetching the English OCR model once into ${langPath}`);
  const response = await fetch(LANG_SOURCE);
  if (!response.ok) throw new Error(`language data download failed: ${response.status}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

const digitsOnly = (text: string) => normalizeOcrDigits(text).replace(/\D/g, '');
const hiddenPart = (number: string, kind: 'aadhaar' | 'bank') =>
  kind === 'aadhaar' ? number.slice(0, 8) : number.slice(0, -4);

type Mode = 'unknown_slot' | 'known_slot';

function requestFor(doc: SyntheticDocument, mode: Mode): MaskRequest {
  if (mode === 'unknown_slot') return {};
  if (doc.kind === 'identity_card') return { expect: ['aadhaar'] };
  if (doc.kind === 'passbook') return { expect: ['bank_account'] };
  return {};
}

interface Row {
  id: string;
  kind: string;
  hard: boolean;
  layout: string;
  font: string;
  rotation: number;
  blur: number;
  noise: number;
  jpegQuality: number;
  width: number;
  status: string;
  aadhaarExpected: number;
  aadhaarFound: number;
  bankExpected: number;
  bankFound: number;
  unexpectedSpans: number;
  leakInText: boolean;
  leakOnReread: boolean;
  passes: number;
  totalMs: number;
  ocrMs: number;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)] ?? 0);
}

async function runOne(
  doc: SyntheticDocument,
  mode: Mode,
  masker: DocumentMasker,
  checker: Worker,
): Promise<Row> {
  const { expected } = doc;
  // A copy, because `mask` zeroes what it is given.
  const outcome = await masker.mask(Buffer.from(doc.photo), requestFor(doc, mode));
  const row: Row = {
    id: doc.id,
    kind: doc.kind,
    hard: doc.hard,
    layout: doc.layout,
    font: doc.font,
    rotation: doc.rotation,
    blur: doc.blur,
    noise: doc.noise,
    jpegQuality: doc.jpegQuality,
    width: doc.width,
    status: outcome.status,
    aadhaarExpected: expected.aadhaar.length,
    aadhaarFound: 0,
    bankExpected: expected.bank.length,
    bankFound: 0,
    unexpectedSpans: 0,
    leakInText: false,
    leakOnReread: false,
    passes: outcome.timings.passes,
    totalMs: Math.round(outcome.timings.totalMs),
    ocrMs: Math.round(outcome.timings.ocrMs),
  };
  if (outcome.status === 'needs_review') return row;

  const aadhaarLast = [...outcome.aadhaarLastFour];
  for (const n of expected.aadhaar) {
    const i = aadhaarLast.indexOf(n.slice(-4));
    if (i >= 0) {
      row.aadhaarFound += 1;
      aadhaarLast.splice(i, 1);
    }
  }
  const bankLast = [...outcome.bankAccountLastFour];
  for (const n of expected.bank) {
    const i = bankLast.indexOf(n.slice(-4));
    if (i >= 0) {
      row.bankFound += 1;
      bankLast.splice(i, 1);
    }
  }
  row.unexpectedSpans = aadhaarLast.length + bankLast.length;

  const textDigits = digitsOnly(outcome.text);
  const { data } = await checker.recognize(outcome.image);
  const rereadDigits = digitsOnly(data.text);
  const hidden = [
    ...expected.aadhaar.map((n) => hiddenPart(n, 'aadhaar')),
    ...expected.bank.map((n) => hiddenPart(n, 'bank')),
  ];
  row.leakInText = hidden.some((h) => textDigits.includes(h));
  row.leakOnReread = hidden.some((h) => rereadDigits.includes(h));
  writeFileSync(join(outDir, `${doc.id}-${mode}-masked.jpg`), outcome.image);
  return row;
}

function summarize(rows: Row[]) {
  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  const aadhaarExpected = sum((r) => r.aadhaarExpected);
  const aadhaarFound = sum((r) => r.aadhaarFound);
  const bankExpected = sum((r) => r.bankExpected);
  const bankFound = sum((r) => r.bankFound);
  const negatives = rows.filter((r) => r.aadhaarExpected === 0 && r.bankExpected === 0);
  // A positive document that was neither masked correctly nor held for review.
  const missedAndReturned = rows.filter(
    (r) =>
      r.status !== 'needs_review' &&
      (r.aadhaarFound < r.aadhaarExpected || r.bankFound < r.bankExpected),
  );
  const times = rows.map((r) => r.totalMs);
  return {
    documents: rows.length,
    aadhaar: {
      expected: aadhaarExpected,
      maskedWithCorrectLastFour: aadhaarFound,
      detectionRate: aadhaarExpected ? aadhaarFound / aadhaarExpected : 1,
    },
    bankAccount: {
      expected: bankExpected,
      maskedWithCorrectLastFour: bankFound,
      detectionRate: bankExpected ? bankFound / bankExpected : 1,
    },
    hardPhotos: {
      documents: rows.filter((r) => r.hard).length,
      numbersExpected: sum((r) => (r.hard ? r.aadhaarExpected + r.bankExpected : 0)),
      numbersMasked: sum((r) => (r.hard ? r.aadhaarFound + r.bankFound : 0)),
    },
    heldForReview: rows.filter((r) => r.status === 'needs_review').map((r) => r.id),
    missedAndReturned: missedAndReturned.map((r) => r.id),
    negatives: negatives.length,
    falsePositiveDocuments: negatives.filter((r) => r.status !== 'clean').length,
    unexpectedSpans: sum((r) => r.unexpectedSpans),
    leaksInText: rows.filter((r) => r.leakInText).map((r) => r.id),
    leaksOnOcrReread: rows.filter((r) => r.leakOnReread).map((r) => r.id),
    timePerImageMs: {
      mean: Math.round(sum((r) => r.totalMs) / rows.length),
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      max: Math.max(...times),
    },
  };
}

async function main() {
  await ensureLanguageData();
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dirname(resultFile), { recursive: true });

  const genStarted = performance.now();
  const docs = await generateDocuments();
  const generateMs = performance.now() - genStarted;

  const coldStarted = performance.now();
  const masker = await createDocumentMasker({ langPath });
  const coldStartMs = performance.now() - coldStarted;
  const checker = await createWorker('eng', 1, { langPath, cacheMethod: 'none', gzip: true });

  const results: Record<Mode, Row[]> = { unknown_slot: [], known_slot: [] };
  for (const mode of ['unknown_slot', 'known_slot'] as const) {
    for (const doc of docs) {
      const row = await runOne(doc, mode, masker, checker);
      results[mode].push(row);
      console.log(
        `${mode.padEnd(12)} ${row.id} ${row.kind.padEnd(13)} ${row.hard ? 'hard' : '    '} ${row.status.padEnd(12)} aadhaar ${row.aadhaarFound}/${row.aadhaarExpected} bank ${row.bankFound}/${row.bankExpected} extra ${row.unexpectedSpans} leak ${row.leakInText || row.leakOnReread ? 'YES' : 'no'} ${row.totalMs} ms`,
      );
    }
  }
  for (const doc of docs) doc.photo.fill(0);
  await masker.close();
  await checker.terminate();

  const summary = {
    ranAt: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}, Node ${process.version}`,
    engine: 'tesseract.js 7, eng 4.0.0_best_int (LSTM), up to four readings per photo',
    generateMs: Math.round(generateMs),
    coldStartMs: Math.round(coldStartMs),
    unknownSlot: summarize(results.unknown_slot),
    knownSlot: summarize(results.known_slot),
    rows: results,
  };
  writeFileSync(resultFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, rows: undefined }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
