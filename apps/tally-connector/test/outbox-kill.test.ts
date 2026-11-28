import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Outbox } from '../src/outbox';
import { FixtureTally } from './fixture-tally';
import { COMPANIES, CONNECTOR_ID, KEY, tempDir } from './harness';
import { StubBos } from './stub-bos';

/**
 * The outbox across a kill (ADR 0013): a connector process is killed while its batch is with the
 * BOS, then started again on the same outbox file. Whether the BOS had applied the batch or not,
 * the restarted connector sends the same body under the same key, and the BOS applies it once.
 */

const COMPANY = COMPANIES[0]?.name ?? '';
// tsx, a development tool of the repository, loads the child's TypeScript inside the one Node
// process (its command line would start a second process, which a kill would leave running).
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;
const child = fileURLToPath(new URL('./child-connector.ts', import.meta.url));

let tally: FixtureTally;
let bos: StubBos;
let dir: ReturnType<typeof tempDir>;
const running: ChildProcess[] = [];

beforeEach(async () => {
  tally = new FixtureTally();
  tally.addCompany(COMPANY);
  await tally.start();
  bos = new StubBos(CONNECTOR_ID, KEY);
  await bos.start();
  dir = tempDir();
});

afterEach(async () => {
  for (const process of running.splice(0)) process.kill('SIGKILL');
  await tally.close();
  await bos.close();
  dir.remove();
});

function connector(): {
  process: ChildProcess;
  done: Promise<{ code: number | null; out: string }>;
} {
  const process = spawn(
    globalThis.process.execPath,
    ['--import', tsx, child, join(dir.dir, 'outbox.sqlite'), tally.url, bos.url],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  running.push(process);
  let out = '';
  process.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
  const done = new Promise<{ code: number | null; out: string }>((resolve) => {
    process.on('exit', (code) => {
      resolve({ code, out });
    });
  });
  return { process, done };
}

async function killMidBatch(hold: 'before' | 'after'): Promise<string> {
  bos.knobs.holdBatches = hold;
  const first = connector();
  await bos.waitForHeldBatch();
  first.process.kill('SIGKILL');
  await first.done;
  // The BOS sees the connection close; a held batch is then never applied.
  for (let i = 0; i < 200 && bos.heldCount() > 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(bos.heldCount()).toBe(0);
  bos.release();

  // The killed process left its page pending in the outbox, with its key.
  const outbox = new Outbox(join(dir.dir, 'outbox.sqlite'));
  const pending = outbox.pending();
  outbox.close();
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ kind: 'batch', fromAlterId: 0, maxAlterId: 5 });
  return pending[0]?.idempotencyKey ?? '';
}

describe('the outbox across a kill mid-batch', () => {
  it('sends the batch again after a kill before the BOS applied it', async () => {
    for (let i = 0; i < 8; i += 1) tally.addVoucher(COMPANY, { type: 'Sales' });
    const key = await killMidBatch('before');
    expect(bos.applied).toHaveLength(0);

    const second = await connector().done;
    expect(second).toMatchObject({ code: 0, out: '{"outcome":"caught_up"}\n' });
    expect(bos.batches.map((b) => [b.from, b.to, b.key === key])).toEqual([
      [0, 5, true],
      [5, 8, false],
    ]);
    expect(bos.applied).toHaveLength(8);
    expect(bos.appliedTwice()).toEqual([]);
  }, 30_000);

  it('applies the batch once after a kill between the BOS applying it and the answer', async () => {
    for (let i = 0; i < 8; i += 1) tally.addVoucher(COMPANY, { type: 'Sales' });
    const key = await killMidBatch('after');
    expect(bos.applied).toHaveLength(5);

    const second = await connector().done;
    expect(second).toMatchObject({ code: 0, out: '{"outcome":"caught_up"}\n' });
    expect(bos.batches.map((b) => [b.from, b.to, b.key === key])).toEqual([
      [0, 5, true],
      [5, 8, false],
    ]);
    expect(bos.applied).toHaveLength(8);
    expect(bos.appliedTwice()).toEqual([]);
    const outbox = new Outbox(join(dir.dir, 'outbox.sqlite'));
    expect(outbox.depth()).toBe(0);
    outbox.close();
  }, 30_000);
});
