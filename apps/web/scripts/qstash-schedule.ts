// Creates or updates the QStash schedules: the outbox publisher every minute, the safety net behind
// the nudge each command sends, and the sweep of abandoned uploads every hour (docs/runbooks/
// DEPLOY.md). Run once per environment, with that environment's QSTASH_TOKEN, signing keys and
// BETTER_AUTH_URL set.
// Usage: pnpm --filter web qstash-schedule
import { Client } from '@upstash/qstash';
import { FILES_SWEEP_PATH, qstashConfig, workerUrl } from '../src/workers/qstash';

/** Fixed, so running the script again updates each schedule instead of adding another. */
const SCHEDULE_ID = 'outbox-publish';
const SWEEP_SCHEDULE_ID = 'files-sweep';

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
