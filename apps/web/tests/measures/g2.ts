// The G2 measures (docs/03-roadmap-appendix/phase2.md §8.1; results in docs/04-architecture-appendix/
// under "Measured (G2)"). Each runs against this machine's production build, started here with
// `next start` (run `pnpm build` and, for dial and screen-pop, `pnpm --filter web e2e:seed` first),
// or against `--base-url`, a server already running:
//   webhooks    answer times at 20, 50 and 100 deliveries a second (--rates, --seconds), each
//               provider's recorded payload, every delivery stored once (counted on the local
//               database only)
//   lead        a Lead Ads event to a lead the caller's search finds, on I1's in-process path with a
//               stand-in for Meta's Graph API (--rounds, --graph-ms); no server
//   dial        the Dial key to the call accepted, on T3's simulated provider (--rounds)
//   screen-pop  Exotel's Passthru call to the caller's page holding it, by the server's transport
//               (--rounds)
//   outbox      the queue's batch call at 200 messages against a local stand-in (--rounds); no server
// The voice turn timing runs in the worker's own workspace:
//   pnpm --filter @shakti/voice-agent exec tsx src/measure-turns.ts
// A base address other than this machine's is refused without --hosted-run-approved: a run on dev
// or staging is the owner's go-ahead, never part of a slice. Nothing here runs in CI.
// Usage: pnpm --filter web exec tsx tests/measures/g2.ts <measure|all> [--base-url <url>]
//        [--port <n>] [--rounds <n>] [--rates 20,50,100] [--seconds <n>] [--graph-ms <n>]
//        [--out <file.json>] [--queue stand-in]
// `--queue stand-in` holds processing off: the server publishes each stored delivery to a local
// queue stand-in, as a hosted server publishes to QStash, so the answer time alone is measured.
import { closeWebhookDb } from '@shakti/db/webhooks';
import { closeDb } from '@shakti/db/testing';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { markdownTable, type TableRow } from '../../scripts/measures/stats';
import { TEST_WEBHOOK_ENV, type WebhookSigningEnv } from '../../src/webhooks/signed-deliveries';
import {
  DIAL_TARGET_MS,
  journeyPopSetup,
  measureDial,
  measureScreenPop,
  POP_TARGET_MS,
  type PopSetup,
} from './browser';
import { LEAD_TARGET_MS, measureLeadPath } from './lead-path';
import { measureBatchCall, queueStandIn } from './outbox-batch';
import { loadRootEnv, measureServer, type MeasureServer } from './server';
import { loadAtRate, WEBHOOK_ANSWER_TARGET_MS } from './webhook-load';

const MEASURES = ['webhooks', 'lead', 'dial', 'screen-pop', 'outbox'] as const;
type Measure = (typeof MEASURES)[number];

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  const value = at === -1 ? undefined : args[at + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
};
const flag = (name: string): boolean => args.includes(`--${name}`);
function whole(name: string, fallback: number, max: number): number {
  const raw = option(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    console.error(`--${name} takes a whole number from 0 to ${String(max)}`);
    process.exit(1);
  }
  return value;
}

if (process.env.CI !== undefined && process.env.CI !== '') {
  console.error('the G2 measures put load on a server and never run in CI');
  process.exit(1);
}
const asked = args.find(
  (a) => !a.startsWith('--') && (a === 'all' || MEASURES.includes(a as Measure)),
);
if (asked === undefined) {
  console.error(`say which measure: ${MEASURES.join(', ')} or all`);
  process.exit(1);
}
const chosen: readonly Measure[] = asked === 'all' ? MEASURES : [asked as Measure];

loadRootEnv();
const baseUrl = option('base-url');
const local =
  baseUrl === undefined || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname);
if (!local && !flag('hosted-run-approved')) {
  console.error(
    'a run against a hosted site is the owner’s go-ahead: pass --hosted-run-approved only with it',
  );
  process.exit(1);
}
const defaultPort = Number(
  new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').port || 3000,
);
const port = whole('port', defaultPort, 65_535);
const rates = (option('rates') ?? '20,50,100').split(',').map(Number);
if (rates.some((r) => !Number.isInteger(r) || r < 1 || r > 500)) {
  console.error('--rates takes whole numbers from 1 to 500, separated by commas');
  process.exit(1);
}
const seconds = whole('seconds', 30, 600);
const queue = option('queue');
if (queue !== undefined && (queue !== 'stand-in' || baseUrl !== undefined)) {
  console.error('--queue takes stand-in, and only for the server started here');
  process.exit(1);
}

/** The phrases deliveries are signed with: the test ones, or the target's own from the env. */
function signingEnv(): WebhookSigningEnv {
  if (baseUrl === undefined) return TEST_WEBHOOK_ENV;
  const names = Object.keys(TEST_WEBHOOK_ENV) as (keyof WebhookSigningEnv)[];
  const missing = names.filter((n) => (process.env[n] ?? '') === '');
  if (missing.length > 0) {
    console.error(`set the target's ${missing.join(', ')} first`);
    process.exit(1);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n] ?? ''])) as WebhookSigningEnv;
}

/** The screen-pop's caller and numbers: the journeys' seed locally, from the env elsewhere. */
function popSetup(): PopSetup {
  if (baseUrl === undefined) return journeyPopSetup();
  const env = (n: string) => process.env[n] ?? '';
  const names = [
    'G2_POP_EMAIL',
    'G2_POP_PASSWORD',
    'EXOTEL_INCOMING_SECRET',
    'G2_POP_CALL_TO',
    'G2_POP_DIAL_WHOM',
    'G2_POP_CALL_FROM',
  ];
  const missing = names.filter((n) => env(n) === '');
  if (missing.length > 0) {
    console.error(`set ${missing.join(', ')} first`);
    process.exit(1);
  }
  return {
    person: { email: env('G2_POP_EMAIL'), password: env('G2_POP_PASSWORD') },
    incomingSecret: env('EXOTEL_INCOMING_SECRET'),
    callTo: env('G2_POP_CALL_TO'),
    dialWhom: env('G2_POP_DIAL_WHOM'),
    callFrom: env('G2_POP_CALL_FROM'),
  };
}

const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  machine: {
    processors: cpus().length,
    model: cpus()[0]?.model ?? 'unknown',
    memoryGb: Math.round(totalmem() / 2 ** 30),
  },
  target: baseUrl ?? 'next start on this machine',
};
const rows: TableRow[] = [];
const needsServer = chosen.some((m) => m === 'webhooks' || m === 'dial' || m === 'screen-pop');
let server: MeasureServer | undefined;
const stand = queue === undefined ? undefined : await queueStandIn();
report.processing =
  stand === undefined
    ? 'in the server after each answer (no queue)'
    : 'held off: each delivery published to a local queue stand-in';

try {
  if (needsServer) server = await measureServer({ baseUrl, port, queueUrl: stand?.url });
  for (const measure of chosen) {
    console.error(`measuring ${measure}`);
    if (measure === 'webhooks' && server !== undefined) {
      const env = signingEnv();
      const results = [];
      for (const rate of rates) {
        const result = await loadAtRate({
          baseUrl: server.baseUrl,
          rate,
          seconds,
          env,
          countStored: server.local,
        });
        results.push(result);
        const stored =
          result.stored === undefined
            ? 'stored once: not counted (not this machine’s database)'
            : `stored once: ${result.stored.ok ? 'yes' : 'NO'} (${String(result.stored.stored)} of ${String(result.stored.sent)})`;
        const failed = Object.entries(result.notOk)
          .map(([status, n]) => `${String(n)} × ${status}`)
          .join(', ');
        rows.push({
          measure: `webhook answer at ${String(rate)}/s${stand === undefined ? '' : ', processing held off'}`,
          stats: result.answers,
          target: { stat: 'max', limitMs: WEBHOOK_ANSWER_TARGET_MS },
          note: `${stored}; not 200: ${failed === '' ? 'none' : failed}; send lag p99 ${String(result.sendLag.p99)} ms`,
        });
        // Let the server finish processing before the next rate.
        await new Promise((r) => setTimeout(r, 5_000));
      }
      report.webhooks = results;
      if (stand !== undefined) {
        // Every new delivery was handed to the queue, none processed by the server.
        report.queuePublishes = stand.calls.filter((c) => c.path.startsWith('/v2/publish')).length;
      }
    } else if (measure === 'lead') {
      const result = await measureLeadPath({
        rounds: whole('rounds', 20, 1_000),
        graphMs: whole('graph-ms', 0, 10_000),
      });
      report.lead = result;
      rows.push({
        measure: 'Lead Ads event to the caller’s lead (in process)',
        stats: result.visible,
        target: { stat: 'max', limitMs: LEAD_TARGET_MS },
        note: `route answer p50 ${String(result.answer.p50)} ms; lost ${String(result.lost)}`,
      });
    } else if (measure === 'dial' && server !== undefined) {
      const result = await measureDial({
        baseUrl: server.baseUrl,
        rounds: whole('rounds', 10, 200),
        localClock: server.local,
      });
      report.dial = result;
      rows.push({
        measure: 'Dial key to the call accepted',
        stats: result.accepted,
        target: { stat: 'p95', limitMs: DIAL_TARGET_MS },
        note: `dial action answered p50 ${String(result.action.p50)} ms`,
      });
    } else if (measure === 'screen-pop' && server !== undefined) {
      const result = await measureScreenPop({
        baseUrl: server.baseUrl,
        rounds: whole('rounds', 30, 500),
        setup: popSetup(),
      });
      report.screenPop = result;
      rows.push({
        measure: `screen-pop by ${result.transport}`,
        stats: result.pop,
        target: { stat: 'p95', limitMs: POP_TARGET_MS },
        note: `${String(Math.round(result.within2s * 100))} % within 2 s; Passthru answered p50 ${String(result.passthru.p50)} ms`,
      });
    } else if (measure === 'outbox') {
      const results = await measureBatchCall({ rounds: whole('rounds', 20, 1_000) });
      report.outbox = results;
      for (const r of results) {
        rows.push({
          measure: `batch call of 200, ${r.call}`,
          stats: r.ms,
          note: `stand-in; ${String(r.bytes)} bytes; ${String(r.messagesPerCall)} messages a call; all accepted: ${r.allAccepted ? 'yes' : 'NO'}`,
        });
      }
    }
  }
} finally {
  await server?.stop();
  await stand?.close();
  await closeWebhookDb();
  await closeDb();
}

const out = option('out');
if (out !== undefined) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${markdownTable(rows)}\n`);
