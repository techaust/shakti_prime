import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JOURNEY_SERVER_ENV } from '../../e2e/setup/server-env';
import { TEST_WEBHOOK_ENV } from '../../src/webhooks/signed-deliveries';

/**
 * The server a G2 measure runs against (docs/runs/phase2/g2-measures.md): by default the production
 * build on this machine, started here with `next start` as the journeys start it, plus the webhook
 * routes' test phrases and no queue (so a delivery is processed in the server after its answer, as
 * locally and in CI); or, given `--base-url`, a server already running, which is only read and
 * never started or stopped here.
 */

const WEB_DIR = resolve(import.meta.dirname, '..', '..');
const ROOT_ENV = resolve(WEB_DIR, '..', '..', '.env');

/** The repository's `.env` (database addresses and passwords), as the journeys load it. */
export function loadRootEnv(): void {
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
}

/** The settings the measuring server starts with: the journeys' and the webhook test phrases. */
export const MEASURE_SERVER_ENV = {
  ...JOURNEY_SERVER_ENV,
  ...TEST_WEBHOOK_ENV,
} as const;

/** QStash's settings, removed so the server processes deliveries itself after answering. */
const QUEUE_VARIABLES = [
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'QSTASH_URL',
];

export interface MeasureServer {
  baseUrl: string;
  /** Whether this process started it (and so owns its settings and stops it). */
  local: boolean;
  stop: () => Promise<void>;
}

async function healthy(baseUrl: string): Promise<boolean> {
  try {
    const answer = await fetch(new URL('/api/v1/health', baseUrl), {
      signal: AbortSignal.timeout(2_000),
    });
    return answer.ok;
  } catch {
    return false;
  }
}

/** Whether the server on `baseUrl` serves this checkout's build (as the journeys' setup checks). */
async function servesThisBuild(baseUrl: string): Promise<boolean> {
  const buildId = readFileSync(join(WEB_DIR, '.next', 'BUILD_ID'), 'utf8').trim();
  const manifest = await fetch(new URL(`/_next/static/${buildId}/_buildManifest.js`, baseUrl));
  return manifest.status === 200;
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      done();
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(timer);
      done();
    });
    child.kill('SIGTERM');
  });
}

/**
 * The server to measure: `baseUrl` when given (it must answer its health check), else
 * `next start` on `port` with `MEASURE_SERVER_ENV`, once the production build exists.
 */
export async function measureServer(options: {
  baseUrl?: string | undefined;
  port: number;
  /**
   * A queue address (the local stand-in): the server then publishes each stored delivery there, as
   * a hosted server publishes to QStash, instead of processing it itself after the answer.
   */
  queueUrl?: string | undefined;
}): Promise<MeasureServer> {
  if (options.baseUrl !== undefined) {
    const url = new URL(options.baseUrl);
    if (!(await healthy(url.origin))) {
      throw new Error(`${url.origin} does not answer /api/v1/health`);
    }
    return { baseUrl: url.origin, local: false, stop: () => Promise.resolve() };
  }
  if (!existsSync(join(WEB_DIR, '.next', 'BUILD_ID'))) {
    throw new Error('no production build: run `pnpm build` first');
  }
  const baseUrl = `http://localhost:${String(options.port)}`;
  if (await healthy(baseUrl)) {
    throw new Error(`port ${String(options.port)} is taken: stop that server or pass --port`);
  }
  const env: NodeJS.ProcessEnv = { ...process.env, ...MEASURE_SERVER_ENV, NODE_ENV: 'production' };
  for (const name of QUEUE_VARIABLES) Reflect.deleteProperty(env, name);
  if (options.queueUrl !== undefined) {
    Object.assign(env, {
      QSTASH_URL: options.queueUrl,
      QSTASH_TOKEN: 'g2 measure stand-in, accepted by no queue',
      QSTASH_CURRENT_SIGNING_KEY: 'g2 measure current key',
      QSTASH_NEXT_SIGNING_KEY: 'g2 measure next key',
      BETTER_AUTH_URL: baseUrl,
    });
  }
  const nextBin = join(WEB_DIR, 'node_modules', '.bin', 'next');
  const child = spawn(nextBin, ['start', '-p', String(options.port)], {
    cwd: WEB_DIR,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => {
    errors = `${errors}${chunk.toString('utf8')}`.slice(-4_000);
    if (process.env.G2_SERVER_LOG === '1') process.stderr.write(chunk);
  });
  const deadline = Date.now() + 120_000;
  while (!(await healthy(baseUrl))) {
    if (child.exitCode !== null) throw new Error(`next start stopped: ${errors}`);
    if (Date.now() > deadline) {
      await stopChild(child);
      throw new Error('next start did not answer within 2 minutes');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!(await servesThisBuild(baseUrl))) {
    await stopChild(child);
    throw new Error('the server does not serve this build');
  }
  return { baseUrl, local: true, stop: () => stopChild(child) };
}
