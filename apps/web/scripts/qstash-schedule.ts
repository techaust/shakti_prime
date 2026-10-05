// Creates or updates the QStash schedules (docs/runbooks/DEPLOY.md): the outbox publisher every
// minute, the safety net behind the nudge each command sends, and the lead rescoring each night.
// Run once per environment, with that environment's QSTASH_TOKEN, signing keys and
// BETTER_AUTH_URL set.
// Usage: pnpm --filter web qstash-schedule
import { Client } from '@upstash/qstash';
import { LEAD_RESCORE_PATH, qstashConfig, workerUrl } from '../src/workers/qstash';

/** Fixed, so running the script again updates each schedule instead of adding another. */
const SCHEDULE_ID = 'outbox-publish';
const RESCORE_SCHEDULE_ID = 'lead-rescore';
/** 21:30 UTC, three in the morning in India, when no one is calling. */
const RESCORE_CRON = '30 21 * * *';

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
