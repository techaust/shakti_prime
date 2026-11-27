import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BosClient } from '../src/client';
import type { CompanyMapping } from '../src/config';
import { createMemoryLog } from '../src/log';
import { Outbox } from '../src/outbox';
import { SETTINGS, type Settings } from '../src/settings';
import { Syncer } from '../src/sync';
import { TallyReader } from '../src/tally/reader';
import { FixtureTally } from './fixture-tally';
import { StubBos } from './stub-bos';

/** The pieces of one connector against the fixture Tally and the stub BOS, with quick settings. */

// Low-entropy phrases, so the secret scan never mistakes them for keys (CLAUDE.md).
export const CONNECTOR_ID = '01931f6e-8a2b-7c3d-9e4f-00000000c0de';
export const KEY = 'tally-connector-test-key-one-for-the-stub';

export const COMPANIES: CompanyMapping[] = [
  { name: 'Shakti Supreme Pvt Ltd', entityCode: 'SS' },
  { name: 'Shakti Motor Pumps', entityCode: 'SMP' },
];

export const FAST: Settings = {
  ...SETTINGS,
  pageSize: 5,
  snapshotPageSize: 7,
  tallyPauseMs: 0,
  tallyTimeoutMs: 1_000,
  tallyRetries: 1,
  tallyBackoffMs: 5,
  bosTimeoutMs: 1_000,
  bosRetries: 1,
  bosBackoffMs: 5,
  bosMaxRetryAfterMs: 50,
};

export function tempDir(): { dir: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tally-connector-'));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface Harness {
  tally: FixtureTally;
  bos: StubBos;
  outbox: Outbox;
  syncer: Syncer;
  log: ReturnType<typeof createMemoryLog>;
  clock: { now: Date };
  dir: string;
  /** A fresh syncer on the same outbox, as after a restart. */
  restart: () => Syncer;
  close: () => Promise<void>;
}

export async function harness(
  options: { settings?: Partial<Settings>; companies?: CompanyMapping[]; now?: Date } = {},
): Promise<Harness> {
  const settings = { ...FAST, ...options.settings };
  const companies = options.companies ?? COMPANIES;
  const tally = new FixtureTally();
  for (const company of companies) tally.addCompany(company.name);
  await tally.start();
  const bos = new StubBos(CONNECTOR_ID, KEY);
  await bos.start();
  const { dir, remove } = tempDir();
  const clock = { now: options.now ?? new Date('2026-11-27T06:00:00Z') };
  const open = () => new Outbox(join(dir, 'outbox.sqlite'), () => clock.now.getTime());
  let outbox = open();
  const log = createMemoryLog();
  const build = () =>
    new Syncer({
      companies,
      reader: new TallyReader({ url: tally.url, settings, log }),
      client: new BosClient({
        baseUrl: bos.url,
        connectorId: CONNECTOR_ID,
        key: KEY,
        settings,
        log,
      }),
      outbox,
      log,
      settings,
      now: () => clock.now,
    });
  const h: Harness = {
    tally,
    bos,
    outbox,
    syncer: build(),
    log,
    clock,
    dir,
    restart: () => {
      outbox.close();
      outbox = open();
      h.outbox = outbox;
      h.syncer = build();
      return h.syncer;
    },
    close: async () => {
      outbox.close();
      await tally.close();
      await bos.close();
      remove();
    },
  };
  return h;
}
