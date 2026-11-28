import { BosClient, BosRefused } from './client';
import {
  ConfigError,
  bosOrigin,
  checkConfig,
  writeConfig,
  type CompanyMapping,
  type ConfigEnvironment,
  type ConnectorConfig,
} from './config';
import type { Log } from './log';
import { MESSAGES } from './messages';
import { CONNECTOR_VERSION, SETTINGS } from './settings';
import { TallyReader } from './tally/reader';

/**
 * The setup command, run once by the owner under the service's Windows account: it asks for the
 * BOS's address, the connector's id and key (at a hidden prompt) and each Tally company with its
 * BOS company, writes the sealed settings file, and sends one heartbeat to check the BOS answers.
 * The key is never echoed, printed or written anywhere but the sealed file.
 */

export interface Prompter {
  ask(question: string): Promise<string>;
  /** Asks without showing what is typed. */
  askHidden(question: string): Promise<string>;
  say(text: string): void;
}

export interface SetupOptions {
  prompter: Prompter;
  configPath: string;
  env: ConfigEnvironment;
  tallyUrl: string;
  log: Log;
  fetch?: typeof fetch;
}

const ATTEMPTS = 3;

async function askUntil(
  prompter: Prompter,
  question: string,
  accept: (value: string) => boolean,
  problem: string,
): Promise<string | undefined> {
  for (let i = 0; i < ATTEMPTS; i += 1) {
    const value = (await prompter.ask(question)).trim();
    if (accept(value)) return value;
    prompter.say(problem);
  }
  return undefined;
}

/** Answers the exit code: 0 set up, 1 not. */
export async function runSetup(options: SetupOptions): Promise<number> {
  const { prompter, env } = options;
  const dev = env.dev && env.platform !== 'win32';
  prompter.say(MESSAGES.setupIntro);
  const bosUrl = await askUntil(
    prompter,
    MESSAGES.askBosUrl,
    (v) => bosOrigin(v, dev) !== undefined,
    MESSAGES.problems.bos_url,
  );
  if (bosUrl === undefined) return 1;
  const connectorId = (await prompter.ask(MESSAGES.askConnectorId)).trim();
  const key = await prompter.askHidden(MESSAGES.askKey);
  const companies: CompanyMapping[] = [];
  for (;;) {
    const name = (await prompter.ask(MESSAGES.askCompany)).trim();
    if (name === '') break;
    const entityCode = (await prompter.ask(MESSAGES.askEntityCode)).trim().toUpperCase();
    companies.push({ name, entityCode });
  }

  let config: ConnectorConfig;
  try {
    config = checkConfig({ bosUrl, connectorId, key, companies }, dev);
    await writeConfig(options.configPath, config, env);
  } catch (error) {
    if (error instanceof ConfigError) {
      prompter.say(MESSAGES.problems[error.problem]);
      return 1;
    }
    throw error;
  }
  prompter.say(MESSAGES.saved);

  prompter.say(MESSAGES.testing);
  const reader = new TallyReader({
    url: options.tallyUrl,
    settings: { ...SETTINGS, tallyRetries: 0 },
    log: options.log,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  let tallyVersion = 'unknown';
  const reachable = [];
  for (const company of config.companies) {
    const status = await reader.companyStatus(company.name).catch(() => undefined);
    if (status?.tallyVersion !== undefined) tallyVersion = status.tallyVersion;
    reachable.push({
      name: company.name,
      lastAlterId: 0,
      reachable: status !== undefined,
    });
  }
  const client = new BosClient({
    baseUrl: config.bosUrl,
    connectorId: config.connectorId,
    key: config.key,
    settings: SETTINGS,
    log: options.log,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  try {
    await client.heartbeat({
      connectorVersion: CONNECTOR_VERSION,
      tallyVersion,
      companies: reachable,
      queueDepth: 0,
    });
  } catch (error) {
    prompter.say(error instanceof BosRefused ? MESSAGES.testRefused : MESSAGES.testUnavailable);
    return error instanceof BosRefused ? 1 : 0;
  }
  prompter.say(MESSAGES.testOk);
  const closed = reachable.filter((c) => !c.reachable).length;
  if (closed > 0) prompter.say(MESSAGES.tallyNotOpen(closed));
  return 0;
}
