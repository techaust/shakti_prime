import { BosClient } from '../src/client';
import { createMemoryLog } from '../src/log';
import { Outbox } from '../src/outbox';
import { Syncer } from '../src/sync';
import { TallyReader } from '../src/tally/reader';
import { COMPANIES, CONNECTOR_ID, FAST, KEY } from './harness';

/**
 * A connector in a process of its own, for the kill test (`outbox-kill.test.ts`): one sync cycle
 * on the outbox file it is given, against the fixture Tally and the stub BOS, then it prints the
 * outcome. The test kills it part-way and starts it again.
 */
const [outboxPath, tallyUrl, bosUrl] = process.argv.slice(2);
if (outboxPath === undefined || tallyUrl === undefined || bosUrl === undefined) {
  process.stderr.write('child-connector needs an outbox path, a Tally address and a BOS address\n');
  process.exit(2);
}
const settings = { ...FAST, bosTimeoutMs: 30_000, bosRetries: 0 };
const log = createMemoryLog();
const outbox = new Outbox(outboxPath);
const syncer = new Syncer({
  companies: COMPANIES.slice(0, 1),
  reader: new TallyReader({ url: tallyUrl, settings, log }),
  client: new BosClient({ baseUrl: bosUrl, connectorId: CONNECTOR_ID, key: KEY, settings, log }),
  outbox,
  log,
  settings,
});
const outcome = await syncer.cycle();
outbox.close();
process.stdout.write(`${JSON.stringify({ outcome })}\n`);
