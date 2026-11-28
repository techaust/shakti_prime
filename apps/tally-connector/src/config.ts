import { ConnectorHeaders, EntityCodeSchema, TallyCompanySchema } from '@shakti/contracts';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { protect, unprotect, type PowerShell } from './dpapi';

/**
 * The connector's settings (docs/03-roadmap-appendix/phase5.md §6.2): the BOS's address, the
 * connector's id and key, and which Tally company is which BOS company. The setup command writes
 * them once. On Windows the file is sealed with DPAPI to the service's account; anywhere else a
 * plain file is read only with `TALLY_CONNECTOR_DEV=1` (tests and a developer's machine), and a
 * plain file is never read on Windows.
 */

export interface CompanyMapping {
  /** The Tally company's exact name. */
  name: string;
  /** The BOS company it belongs to (`SS`, `SMP`, `ASH`, `RCREF`). */
  entityCode: string;
}

export interface ConnectorConfig {
  /** The BOS's address (an origin, for example `https://shaktiprime.com`). */
  bosUrl: string;
  connectorId: string;
  key: string;
  companies: CompanyMapping[];
}

export type ConfigProblem =
  | 'bos_url'
  | 'connector_id'
  | 'key'
  | 'companies'
  | 'missing'
  | 'unreadable'
  | 'plain_refused'
  | 'sealed_elsewhere';

export class ConfigError extends Error {
  override name = 'ConfigError';
  constructor(readonly problem: ConfigProblem) {
    super(problem);
  }
}

/** The key the BOS issues: at least 32 characters, at most 512, no spaces around it. */
export const KEY_MIN_LENGTH = 32;
const KEY_MAX_LENGTH = 512;
const MAX_COMPANIES = 20;

export interface ConfigEnvironment {
  platform: NodeJS.Platform;
  /** `TALLY_CONNECTOR_DEV=1`: a plain file and a BOS on plain http are allowed off Windows. */
  dev: boolean;
  powershell?: PowerShell;
}

export function environmentFromProcess(): ConfigEnvironment {
  return { platform: process.platform, dev: process.env.TALLY_CONNECTOR_DEV === '1' };
}

/** A BOS address as its origin, or undefined when it is not https (http only in development). */
export function bosOrigin(value: string, dev: boolean): string | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  const allowed = url.protocol === 'https:' || (dev && url.protocol === 'http:');
  if (!allowed || url.username !== '' || url.password !== '') return undefined;
  return url.origin;
}

/** Checks settings read from the file or typed at the setup. */
export function checkConfig(value: unknown, dev: boolean): ConnectorConfig {
  const v = (value ?? {}) as Partial<Record<keyof ConnectorConfig, unknown>>;
  const bosUrl = typeof v.bosUrl === 'string' ? bosOrigin(v.bosUrl, dev) : undefined;
  if (bosUrl === undefined) throw new ConfigError('bos_url');
  const connectorId = ConnectorHeaders.shape['x-connector-id'].safeParse(v.connectorId);
  if (!connectorId.success) throw new ConfigError('connector_id');
  if (
    typeof v.key !== 'string' ||
    v.key.length < KEY_MIN_LENGTH ||
    v.key.length > KEY_MAX_LENGTH ||
    v.key.trim() !== v.key
  ) {
    throw new ConfigError('key');
  }
  if (!Array.isArray(v.companies) || v.companies.length === 0) {
    throw new ConfigError('companies');
  }
  if (v.companies.length > MAX_COMPANIES) throw new ConfigError('companies');
  const companies = v.companies.map((entry: unknown) => {
    const e = (entry ?? {}) as Partial<Record<keyof CompanyMapping, unknown>>;
    const name = TallyCompanySchema.safeParse(e.name);
    const entityCode = EntityCodeSchema.safeParse(e.entityCode);
    if (!name.success || !entityCode.success) throw new ConfigError('companies');
    return { name: name.data, entityCode: entityCode.data };
  });
  if (new Set(companies.map((c) => c.name)).size !== companies.length) {
    throw new ConfigError('companies');
  }
  return { bosUrl, connectorId: connectorId.data, key: v.key, companies };
}

interface SealedFile {
  format: 'dpapi';
  version: 1;
  data: string;
}

interface PlainFile {
  format: 'plain';
  version: 1;
  config: ConnectorConfig;
}

/** Reads and opens the settings file. */
export async function readConfig(path: string, env: ConfigEnvironment): Promise<ConnectorConfig> {
  if (!existsSync(path)) throw new ConfigError('missing');
  let file: { format?: unknown; data?: unknown; config?: unknown };
  try {
    file = (JSON.parse(readFileSync(path, 'utf8')) ?? {}) as typeof file;
  } catch {
    throw new ConfigError('unreadable');
  }
  if (file.format === 'dpapi' && typeof file.data === 'string') {
    if (env.platform !== 'win32') throw new ConfigError('sealed_elsewhere');
    let opened: string;
    try {
      opened = await unprotect(file.data, env.powershell);
    } catch {
      throw new ConfigError('unreadable');
    }
    return checkConfig(JSON.parse(opened), false);
  }
  if (file.format === 'plain') {
    if (env.platform === 'win32' || !env.dev) throw new ConfigError('plain_refused');
    return checkConfig(file.config, true);
  }
  throw new ConfigError('unreadable');
}

/**
 * Writes the settings file: sealed on Windows, plain only in development elsewhere. The file is
 * written beside its final name and renamed, so a cut leaves the old file or the new one.
 */
export async function writeConfig(
  path: string,
  config: ConnectorConfig,
  env: ConfigEnvironment,
): Promise<void> {
  const checked = checkConfig(config, env.dev && env.platform !== 'win32');
  let file: SealedFile | PlainFile;
  if (env.platform === 'win32') {
    file = {
      format: 'dpapi',
      version: 1,
      data: await protect(JSON.stringify(checked), env.powershell),
    };
  } else if (env.dev) {
    file = { format: 'plain', version: 1, config: checked };
  } else {
    throw new ConfigError('plain_refused');
  }
  const temporary = `${path}.new`;
  writeFileSync(temporary, `${JSON.stringify(file)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
