import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { BosClient } from './client';
import { ConfigError, environmentFromProcess, readConfig } from './config';
import { createFileLog, errorKind, logId } from './log';
import { MESSAGES } from './messages';
import { Outbox } from './outbox';
import { Scheduler } from './scheduler';
import { CONNECTOR_VERSION, SETTINGS } from './settings';
import { runSetup, type Prompter } from './setup';
import { Syncer } from './sync';
import { TallyReader } from './tally/reader';

/**
 * The connector's entry point, packaged as one Windows executable and run by WinSW as a service
 * (`run`). `setup` is run once by the owner, under the service's account; `version` prints the
 * version. The folder holding the settings, the outbox and the logs is `TALLY_CONNECTOR_HOME`, by
 * default `%ProgramData%\ShaktiTallyConnector` on Windows.
 */

const DEFAULT_TALLY_URL = 'http://localhost:9000';

function home(): string {
  const chosen = process.env.TALLY_CONNECTOR_HOME;
  if (chosen !== undefined && chosen !== '') return chosen;
  if (process.platform === 'win32') {
    return join(process.env.ProgramData ?? 'C:\\ProgramData', 'ShaktiTallyConnector');
  }
  return join(homedir(), '.shakti-tally-connector');
}

function tallyUrl(): string {
  const value = process.env.TALLY_URL ?? DEFAULT_TALLY_URL;
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('TALLY_URL');
  return url.href;
}

function paths() {
  const dir = home();
  mkdirSync(dir, { recursive: true });
  return {
    config: join(dir, 'connector.settings'),
    outbox: join(dir, 'outbox.sqlite'),
    logs: join(dir, 'logs'),
  };
}

/** Questions on the terminal; the key's answer is read with the echo off. */
function terminalPrompter(): Prompter {
  return {
    async ask(question) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    askHidden(question) {
      const stdin = process.stdin;
      process.stdout.write(question);
      if (!stdin.isTTY) {
        const rl = createInterface({ input: stdin, terminal: false });
        return new Promise((resolve) => {
          rl.once('line', (line) => {
            rl.close();
            resolve(line);
          });
        });
      }
      return new Promise((resolve) => {
        let value = '';
        stdin.setRawMode(true);
        stdin.setEncoding('utf8');
        stdin.resume();
        const onData = (chunk: string) => {
          for (const ch of chunk) {
            if (ch === '\r' || ch === '\n') {
              stdin.off('data', onData);
              stdin.setRawMode(false);
              stdin.pause();
              process.stdout.write('\n');
              resolve(value);
              return;
            }
            if (ch === '\u0003') {
              stdin.setRawMode(false);
              process.stdout.write('\n');
              process.exit(130);
            }
            if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
            else value += ch;
          }
        };
        stdin.on('data', onData);
      });
    },
    say(text) {
      process.stdout.write(`${text}\n`);
    },
  };
}

async function run(): Promise<number> {
  const where = paths();
  const env = environmentFromProcess();
  const log = createFileLog({ dir: where.logs, keepDays: SETTINGS.logKeepDays, echo: env.dev });
  let config;
  try {
    config = await readConfig(where.config, env);
  } catch (error) {
    if (error instanceof ConfigError) {
      log.error('settings_refused', { problem: logId(error.problem) });
      process.stderr.write(`${MESSAGES.problems[error.problem]}\n`);
      return 1;
    }
    throw error;
  }
  const outbox = new Outbox(where.outbox);
  const reader = new TallyReader({ url: tallyUrl(), settings: SETTINGS, log });
  const client = new BosClient({
    baseUrl: config.bosUrl,
    connectorId: config.connectorId,
    key: config.key,
    settings: SETTINGS,
    log,
  });
  const syncer = new Syncer({
    companies: config.companies,
    reader,
    client,
    outbox,
    log,
    settings: SETTINGS,
  });
  const scheduler = new Scheduler(syncer, SETTINGS, log);
  scheduler.start();
  await new Promise<void>((resolve) => {
    const stop = () => {
      void scheduler.stop().finally(() => {
        outbox.close();
        resolve();
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (command === 'version') {
    process.stdout.write(`${CONNECTOR_VERSION}\n`);
    return 0;
  }
  if (command === 'run') return run();
  if (command === 'setup') {
    const where = paths();
    return runSetup({
      prompter: terminalPrompter(),
      configPath: where.config,
      env: environmentFromProcess(),
      tallyUrl: tallyUrl(),
      log: createFileLog({ dir: where.logs, keepDays: SETTINGS.logKeepDays }),
    });
  }
  process.stderr.write(`${MESSAGES.usage}\n`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`The connector stopped on an unexpected error (${errorKind(error)}).\n`);
    process.exitCode = 1;
  },
);
