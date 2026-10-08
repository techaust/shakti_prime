// Creates or updates the QStash schedules (docs/runbooks/deploy.md): the outbox publisher every
// minute, the safety net behind the nudge each command sends, the sweep of abandoned uploads every
// hour, the lead rescoring and the duplicate search each night and the quote expiry each day.
// Run once per environment, with that environment's QSTASH_TOKEN, signing keys, BOS_ENVIRONMENT and
// BETTER_AUTH_URL set.
// Usage: pnpm --filter web qstash-schedule
import { Client } from '@upstash/qstash';
import {
  DUPLICATE_SCAN_PATH,
  FILES_SWEEP_PATH,
  LEAD_RESCORE_PATH,
  QUOTE_EXPIRE_PATH,
  qstashConfig,
  workerUrl,
} from '../src/workers/qstash';

const config = qstashConfig();
if (config === undefined) {
  console.error(
    'set QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY and BETTER_AUTH_URL first',
  );
  process.exit(1);
}
if (!config.publishUrl.startsWith('https://')) {
  console.error(`QStash can only call a public https address, not ${config.publishUrl}`);
  process.exit(1);
}
// One QStash account serves dev and staging: a schedule named for its environment is never
// overwritten by the other's.
const environment = process.env.BOS_ENVIRONMENT ?? '';
if (!/^[a-z]+$/.test(environment)) {
  console.error('set BOS_ENVIRONMENT (dev, staging or production) first');
  process.exit(1);
}

/** Named for the environment, so running the script again updates each schedule in place. */
const SCHEDULE_ID = `outbox-publish-${environment}`;
const SWEEP_SCHEDULE_ID = `files-sweep-${environment}`;
const RESCORE_SCHEDULE_ID = `lead-rescore-${environment}`;
/** 21:30 UTC, three in the morning in India, when no one is calling. */
const RESCORE_CRON = '30 21 * * *';

const client = new Client({
  token: config.token,
  ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  enableTelemetry: false,
  devMode: false,
});
await client.schedules.create({
  scheduleId: SCHEDULE_ID,
  destination: config.publishUrl,
  cron: '* * * * *',
  body: '{}',
  headers: { 'content-type': 'application/json' },
  // A missed minute is covered by the next one; retries would only pile runs up.
  retries: 0,
  timeout: 30,
});
console.log(`schedule ${SCHEDULE_ID} calls ${config.publishUrl} every minute`);

const sweepUrl = workerUrl(config, FILES_SWEEP_PATH);
await client.schedules.create({
  scheduleId: SWEEP_SCHEDULE_ID,
  destination: sweepUrl,
  // Seventeen minutes past each hour, away from the top of the hour other jobs favour.
  cron: '17 * * * *',
  body: '{}',
  headers: { 'content-type': 'application/json' },
  // A missed run is covered by the next hour's.
  retries: 0,
  timeout: 60,
});
console.log(`schedule ${SWEEP_SCHEDULE_ID} calls ${sweepUrl} every hour`);

// The nightly rescoring of open leads (CRM-06): a lead's age and the details it gained since its
// last score. A run that runs out of time hands the rest on itself.
const rescoreUrl = workerUrl(config, LEAD_RESCORE_PATH);
await client.schedules.create({
  scheduleId: RESCORE_SCHEDULE_ID,
  destination: rescoreUrl,
  cron: RESCORE_CRON,
  body: '{}',
  headers: { 'content-type': 'application/json' },
  retries: 3,
  timeout: 60,
});
console.log(`schedule ${RESCORE_SCHEDULE_ID} calls ${rescoreUrl} at ${RESCORE_CRON} (UTC)`);

// The nightly search for duplicate customers and leads (CRM-03), half an hour after the
// rescoring: two customers an import and a form made at the same moment, and an import's rows.
const DUPLICATE_SCAN_SCHEDULE_ID = `duplicate-scan-${environment}`;
const DUPLICATE_SCAN_CRON = '0 22 * * *';
const scanUrl = workerUrl(config, DUPLICATE_SCAN_PATH);
await client.schedules.create({
  scheduleId: DUPLICATE_SCAN_SCHEDULE_ID,
  destination: scanUrl,
  cron: DUPLICATE_SCAN_CRON,
  body: '{}',
  headers: { 'content-type': 'application/json' },
  retries: 3,
  timeout: 60,
});
console.log(
  `schedule ${DUPLICATE_SCAN_SCHEDULE_ID} calls ${scanUrl} at ${DUPLICATE_SCAN_CRON} (UTC)`,
);

// The daily expiry of quotes past their validity (docs/03-roadmap-appendix/phase1.md §7.3), five minutes after
// midnight in India, when the day's last valid quotes have lapsed.
const QUOTE_EXPIRE_SCHEDULE_ID = `quote-expire-${environment}`;
const QUOTE_EXPIRE_CRON = '35 18 * * *';
const expireUrl = workerUrl(config, QUOTE_EXPIRE_PATH);
await client.schedules.create({
  scheduleId: QUOTE_EXPIRE_SCHEDULE_ID,
  destination: expireUrl,
  cron: QUOTE_EXPIRE_CRON,
  body: '{}',
  headers: { 'content-type': 'application/json' },
  retries: 3,
  timeout: 60,
});
console.log(
  `schedule ${QUOTE_EXPIRE_SCHEDULE_ID} calls ${expireUrl} at ${QUOTE_EXPIRE_CRON} (UTC)`,
);
