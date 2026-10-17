// Creates or updates the QStash schedules (docs/runbooks/deploy.md §2 step 6): the outbox
// publisher every minute, the safety net behind the nudge each command sends, the sweep of
// abandoned uploads every hour, the lead rescoring, the duplicate search and the anonymisation of
// old unqualified leads each night, the quote expiry each day, the notification scan every five
// minutes and the check of the database's scheduled jobs every hour. The ids, routes, crons and
// retries are `qstashSchedules()` in src/workers/qstash-schedules.ts.
// Run once per environment, with that environment's QSTASH_TOKEN, signing keys, BOS_ENVIRONMENT
// (dev, staging or production) and BETTER_AUTH_URL set.
// Usage: pnpm --filter web qstash-schedule
import { Client } from '@upstash/qstash';
import { qstashConfig } from '../src/workers/qstash';
import { hostedEnvironment, qstashSchedules } from '../src/workers/qstash-schedules';

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
// One QStash account serves every environment: a schedule named for its environment is never
// overwritten by another's.
const environment = hostedEnvironment(process.env.BOS_ENVIRONMENT);
if (environment === undefined) {
  console.error('set BOS_ENVIRONMENT (dev, staging or production) first');
  process.exit(1);
}

const client = new Client({
  token: config.token,
  ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  enableTelemetry: false,
  devMode: false,
});
// Named for the environment, so running the script again updates each schedule in place.
for (const schedule of qstashSchedules(environment, config.publishUrl)) {
  await client.schedules.create({
    scheduleId: schedule.scheduleId,
    destination: schedule.destination,
    cron: schedule.cron,
    body: '{}',
    headers: { 'content-type': 'application/json' },
    retries: schedule.retries,
    timeout: schedule.timeout,
  });
  console.log(
    `schedule ${schedule.scheduleId} calls ${schedule.destination} at ${schedule.cron} (UTC)`,
  );
}
