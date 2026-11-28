import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  checkConfig,
  readConfig,
  writeConfig,
  type ConnectorConfig,
} from '../src/config';
import { protect, unprotect, type PowerShell } from '../src/dpapi';
import { CONNECTOR_ID, KEY, tempDir } from './harness';

const CONFIG: ConnectorConfig = {
  bosUrl: 'https://shaktiprime.com',
  connectorId: CONNECTOR_ID,
  key: KEY,
  companies: [{ name: 'Shakti Supreme Pvt Ltd', entityCode: 'SS' }],
};

/**
 * A stand-in for Windows PowerShell: "seals" by wrapping the Base64 it is given, and records each
 * script and input, so a test can see what reaches the command line.
 */
function fakePowerShell(seen: { script: string; input: string }[]): PowerShell {
  return (script, input) => {
    seen.push({ script, input });
    if (script.includes(']::Protect(')) {
      return Promise.resolve(Buffer.from(`sealed:${input}`).toString('base64'));
    }
    return Promise.resolve(
      Buffer.from(input, 'base64')
        .toString()
        .replace(/^sealed:/, ''),
    );
  };
}

let dir: ReturnType<typeof tempDir> = { dir: '', remove: () => undefined };
afterEach(() => {
  dir.remove();
  dir = { dir: '', remove: () => undefined };
});

describe('checking the settings', () => {
  it('takes the BOS origin over https, a UUID, a long key and named companies', () => {
    expect(checkConfig({ ...CONFIG, bosUrl: 'https://shaktiprime.com/api/v1' }, false)).toEqual(
      CONFIG,
    );
    const refused = (value: Partial<ConnectorConfig>, dev = false) => {
      try {
        checkConfig({ ...CONFIG, ...value }, dev);
        return undefined;
      } catch (error) {
        return error instanceof ConfigError ? error.problem : 'other';
      }
    };
    expect(refused({ bosUrl: 'http://shaktiprime.com' })).toBe('bos_url');
    expect(refused({ bosUrl: 'http://127.0.0.1:3000' }, true)).toBeUndefined();
    expect(refused({ bosUrl: 'https://user:pw@shaktiprime.com' })).toBe('bos_url');
    expect(refused({ connectorId: 'connector-1' })).toBe('connector_id');
    expect(refused({ key: 'short' })).toBe('key');
    expect(refused({ key: ` ${KEY}` })).toBe('key');
    expect(refused({ companies: [] })).toBe('companies');
    expect(refused({ companies: [{ name: 'A', entityCode: 'ss' }] })).toBe('companies');
    expect(
      refused({
        companies: [
          { name: 'A', entityCode: 'SS' },
          { name: 'A', entityCode: 'SMP' },
        ],
      }),
    ).toBe('companies');
  });
});

describe('the settings file', () => {
  it('is sealed with DPAPI on Windows, the secret passing on standard input only', async () => {
    dir = tempDir();
    const path = join(dir.dir, 'connector.settings');
    const seen: { script: string; input: string }[] = [];
    const env = { platform: 'win32' as const, dev: false, powershell: fakePowerShell(seen) };
    await writeConfig(path, CONFIG, env);

    const file = readFileSync(path, 'utf8');
    expect(JSON.parse(file)).toMatchObject({ format: 'dpapi', version: 1 });
    expect(file).not.toContain(KEY);
    expect(file).not.toContain(Buffer.from(KEY).toString('base64').slice(0, 20));
    for (const { script, input } of seen) {
      expect(script).not.toContain(KEY);
      expect(script).toContain("'CurrentUser'");
      expect(input).toMatch(/^[A-Za-z0-9+/=]+$/);
    }
    await expect(readConfig(path, env)).resolves.toEqual(CONFIG);
  });

  it('is never plain on Windows, and plain elsewhere only with TALLY_CONNECTOR_DEV=1', async () => {
    dir = tempDir();
    const path = join(dir.dir, 'connector.settings');
    await expect(writeConfig(path, CONFIG, { platform: 'linux', dev: false })).rejects.toEqual(
      new ConfigError('plain_refused'),
    );
    await writeConfig(path, CONFIG, { platform: 'linux', dev: true });
    await expect(readConfig(path, { platform: 'linux', dev: true })).resolves.toEqual(CONFIG);
    await expect(readConfig(path, { platform: 'linux', dev: false })).rejects.toEqual(
      new ConfigError('plain_refused'),
    );
    await expect(
      readConfig(path, { platform: 'win32', dev: true, powershell: fakePowerShell([]) }),
    ).rejects.toEqual(new ConfigError('plain_refused'));

    writeFileSync(path, JSON.stringify({ format: 'dpapi', version: 1, data: 'AAAA' }));
    await expect(readConfig(path, { platform: 'linux', dev: true })).rejects.toEqual(
      new ConfigError('sealed_elsewhere'),
    );
    writeFileSync(path, 'not json');
    await expect(readConfig(path, { platform: 'linux', dev: true })).rejects.toEqual(
      new ConfigError('unreadable'),
    );
    await expect(
      readConfig(join(dir.dir, 'none'), { platform: 'linux', dev: true }),
    ).rejects.toEqual(new ConfigError('missing'));
  });
});

// On the Windows CI runner the real DPAPI seals and opens the settings.
describe.runIf(process.platform === 'win32')('Windows DPAPI', () => {
  it('seals text that only the same account opens', async () => {
    dir = tempDir();
    const sealed = await protect(JSON.stringify(CONFIG));
    expect(sealed).not.toContain(KEY);
    expect(JSON.parse(await unprotect(sealed))).toEqual(CONFIG);
    const path = join(dir.dir, 'connector.settings');
    await writeConfig(path, CONFIG, { platform: 'win32', dev: false });
    await expect(readConfig(path, { platform: 'win32', dev: false })).resolves.toEqual(CONFIG);
  }, 60_000);
});
