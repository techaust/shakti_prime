// The Tally spike, BOS side (ROADMAP §2 week 6, docs/04-architecture-appendix/tally.md). Run on the accounts machine
// (or one that reaches its Tally XML server) against a copy of a company, never the live books:
//   1. reads the vouchers altered after TALLY_SPIKE_SINCE through Tally's XML server, timed;
//   2. shapes them into connector batches of 500 and runs the BOS batch rules (AlterID cursor);
//   3. signs one batch as the connector will and verifies it as the BOS will;
//   4. reads the full GUID snapshot, timed, and diffs it against what step 1 read.
// Tally is only read. Nothing is sent to the BOS: its connector routes arrive in Phase 5.
// Usage: pnpm --filter web spike:tally
import { checkBatch, diffSnapshot } from '@shakti/domain';
import { MAX_VOUCHERS_PER_BATCH, parseBatch } from '../../src/integrations/tally/payloads';
import {
  CONNECTOR_HEADERS,
  signConnectorRequest,
  verifyConnectorRequest,
} from '../../src/integrations/tally/signature';
import {
  parseGuidExport,
  parseVoucherExport,
  voucherGuidsRequest,
  vouchersSinceRequest,
} from '../../src/integrations/tally/tally-xml';

const REQUIRED = [
  'TALLY_URL',
  'TALLY_COMPANY',
  'TALLY_ENTITY_CODE',
  'TALLY_CONNECTOR_ID',
  'TALLY_CONNECTOR_KEY',
] as const;
const TALLY_TIMEOUT_MS = 120_000;
const BATCH_PATH = '/api/v1/connector/tally/batches';

if (process.env.CI !== undefined && process.env.CI !== '') {
  console.error('the Tally spike reads a Tally company and never runs in CI');
  process.exit(1);
}
const missing = REQUIRED.filter((name) => (process.env[name] ?? '') === '');
if (missing.length > 0) {
  console.error(`set ${missing.join(', ')} first (docs/04-architecture-appendix/tally.md)`);
  process.exit(1);
}
const env = (name: (typeof REQUIRED)[number]) => process.env[name] ?? '';
const company = env('TALLY_COMPANY');
const since = Number(process.env.TALLY_SPIKE_SINCE ?? '0');

async function ask(xml: string): Promise<{ body: string; ms: number }> {
  const started = performance.now();
  const response = await fetch(env('TALLY_URL'), {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset=utf-8' },
    body: xml,
    signal: AbortSignal.timeout(TALLY_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Tally answered ${String(response.status)}`);
  return { body, ms: performance.now() - started };
}

// 1. Read.
const read = await ask(vouchersSinceRequest(company, since));
const vouchers = parseVoucherExport(read.body);
console.error(`read ${String(vouchers.length)} vouchers in ${read.ms.toFixed(0)} ms`);

// 2. Batch and apply the cursor rule.
let cursor = since;
let refused = 0;
const batches: string[] = [];
for (let i = 0; i < vouchers.length; i += MAX_VOUCHERS_PER_BATCH) {
  const slice = vouchers.slice(i, i + MAX_VOUCHERS_PER_BATCH);
  const maxAlterId = Math.max(cursor, ...slice.map((v) => Number(v.alterId)));
  const body = {
    company,
    entityCode: env('TALLY_ENTITY_CODE'),
    fromAlterId: cursor,
    maxAlterId,
    vouchers: slice,
    ledgers: [],
  };
  const parsed = parseBatch(body);
  if (!parsed.ok) {
    refused += 1;
    console.error(
      `batch ${String(batches.length + 1)} unreadable: ${parsed.problems.slice(0, 5).join(', ')}`,
    );
    continue;
  }
  const check = checkBatch(cursor, parsed.value);
  if (!check.ok) {
    refused += 1;
    console.error(`batch ${String(batches.length + 1)} refused: ${check.problem}`);
    continue;
  }
  cursor = check.outcome.cursor;
  batches.push(JSON.stringify(body));
}

// 3. Sign one batch as the connector will, verify it as the BOS will.
let signatureRoundTrip = 'no batch to sign';
const first = batches[0];
if (first !== undefined) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = new Headers({
    [CONNECTOR_HEADERS.id]: env('TALLY_CONNECTOR_ID'),
    [CONNECTOR_HEADERS.timestamp]: timestamp,
    [CONNECTOR_HEADERS.signature]: signConnectorRequest(
      env('TALLY_CONNECTOR_KEY'),
      'POST',
      BATCH_PATH,
      timestamp,
      first,
    ),
  });
  const verdict = verifyConnectorRequest(
    { method: 'POST', pathWithQuery: BATCH_PATH, headers, body: first },
    (id) => (id === env('TALLY_CONNECTOR_ID') ? [env('TALLY_CONNECTOR_KEY')] : []),
    new Date(),
  );
  signatureRoundTrip = verdict.ok ? 'verified' : verdict.problem;
}

// 4. The GUID snapshot.
const snapshot = await ask(voucherGuidsRequest(company));
const guids = parseGuidExport(snapshot.body);
console.error(`snapshot of ${String(guids.length)} GUIDs in ${snapshot.ms.toFixed(0)} ms`);
const readAt = new Date(Date.now() - 1_000);
const diff = diffSnapshot(
  vouchers.map((v) => ({ guid: String(v.guid), receivedAt: readAt, tombstoned: false })),
  { voucherGuids: guids, asOf: new Date() },
);

process.stdout.write(
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      since,
      read: { vouchers: vouchers.length, ms: Math.round(read.ms), bytes: read.body.length },
      batches: { accepted: batches.length, refused, cursor },
      signatureRoundTrip,
      snapshot: {
        guids: guids.length,
        ms: Math.round(snapshot.ms),
        bytes: snapshot.body.length,
        diff: diff.ok
          ? {
              tombstones: diff.diff.tombstones.length,
              missing: diff.diff.missing.length,
              reappeared: diff.diff.reappeared.length,
            }
          : diff.problem,
      },
    },
    null,
    2,
  )}\n`,
);
