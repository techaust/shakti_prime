import { newId, type Principal } from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import {
  envelopeCipher,
  executeCommand,
  localKeyProvider,
  newConnectorKey,
  registerTallyConnector,
  revokeTallyConnector,
} from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryAlertSink } from '../src/observability/alerts';
import { runTallyAlerts } from '../src/workers/tally-alerts';

// TC2's connector alerts on real Postgres (docs/03-roadmap-appendix/phase5.md §6.3): the hourly
// jobs check tells of a connector silent for thirty minutes once per silence, and of one holding
// rows it could not send once per stretch, by id and count only.

const cipher = envelopeCipher(localKeyProvider(Buffer.alloc(32, 17).toString('base64')));
let exec: Principal;
let connectorId: string;

beforeAll(async () => {
  exec = await createTestPrincipal('executive', [1]);
  const made = await executeCommand(
    exec,
    { entityIds: [1] },
    registerTallyConnector,
    { name: `TC2 alerts ${newId().slice(-8)}`, key: newConnectorKey().key },
    { fieldCipher: cipher },
  );
  connectorId = made.id;
});

afterAll(async () => {
  await executeCommand(exec, { entityIds: [1] }, revokeTallyConnector, { connectorId });
  await closeDb();
});

const mine = (sink: ReturnType<typeof memoryAlertSink>) =>
  sink.alerts.filter((a) => a.fields.subject === connectorId).map((a) => a.name);

describe('the Tally connector alerts', () => {
  it('tells nothing of a connector that never checked in', async () => {
    const sink = memoryAlertSink();
    await runTallyAlerts({ requestId: newId(), alerts: sink, now: new Date() });
    expect(mine(sink)).toEqual([]);
  });

  it('tells of a silence and of held rows once each, and again after the next stretch', async () => {
    const now = new Date();
    await asMigrator(
      (m) => m`update tally_connectors
                  set last_heartbeat_at = ${new Date(now.getTime() - 40 * 60_000)},
                      held_rows = 2, held_since = ${new Date(now.getTime() - 60 * 60_000)}
                where id = ${connectorId}`,
    );
    const first = memoryAlertSink();
    await runTallyAlerts({ requestId: newId(), alerts: first, now });
    expect(mine(first).sort()).toEqual(['tally.connector.rows_held', 'tally.connector.silent']);
    expect(first.alerts.find((a) => a.fields.subject === connectorId)?.fields).not.toHaveProperty(
      'name',
    );
    const again = memoryAlertSink();
    await runTallyAlerts({ requestId: newId(), alerts: again, now });
    expect(mine(again)).toEqual([]);
    // It checks in, then falls silent again; its held rows clear and come back.
    const later = new Date(now.getTime() + 2 * 60 * 60_000);
    await asMigrator(
      (m) => m`update tally_connectors
                  set last_heartbeat_at = ${new Date(later.getTime() - 35 * 60_000)},
                      held_since = ${new Date(later.getTime() - 10 * 60_000)}
                where id = ${connectorId}`,
    );
    const next = memoryAlertSink();
    await runTallyAlerts({ requestId: newId(), alerts: next, now: later });
    expect(mine(next).sort()).toEqual(['tally.connector.rows_held', 'tally.connector.silent']);
  });
});
