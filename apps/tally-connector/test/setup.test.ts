import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readConfig } from '../src/config';
import { createMemoryLog } from '../src/log';
import { MESSAGES } from '../src/messages';
import { runSetup, type Prompter } from '../src/setup';
import { FixtureTally } from './fixture-tally';
import { CONNECTOR_ID, KEY, tempDir } from './harness';
import { StubBos } from './stub-bos';

const env = { platform: 'linux' as const, dev: true };
let tally: FixtureTally;
let bos: StubBos;
let dir: ReturnType<typeof tempDir>;

beforeEach(async () => {
  tally = new FixtureTally();
  tally.addCompany('Shakti Supreme Pvt Ltd');
  await tally.start();
  bos = new StubBos(CONNECTOR_ID, KEY);
  await bos.start();
  dir = tempDir();
});
afterEach(async () => {
  await tally.close();
  await bos.close();
  dir.remove();
});

/** Answers the setup's questions in order and keeps what it says and asks. */
function scripted(answers: string[]): Prompter & { shown: string[]; hidden: string[] } {
  const shown: string[] = [];
  const hidden: string[] = [];
  return {
    shown,
    hidden,
    ask: (question) => {
      shown.push(question);
      return Promise.resolve(answers.shift() ?? '');
    },
    askHidden: (question) => {
      hidden.push(question);
      return Promise.resolve(answers.shift() ?? '');
    },
    say: (text) => {
      shown.push(text);
    },
  };
}

describe('the setup command', () => {
  it('asks once, takes the key hidden, writes the settings and checks the BOS answers', async () => {
    const prompter = scripted([
      'ftp://wrong',
      bos.url,
      CONNECTOR_ID,
      KEY,
      'Shakti Supreme Pvt Ltd',
      'ss',
      'Shakti Motor Pumps',
      'SMP',
      '',
    ]);
    const path = join(dir.dir, 'connector.settings');
    const code = await runSetup({
      prompter,
      configPath: path,
      env,
      tallyUrl: tally.url,
      log: createMemoryLog(),
    });
    expect(code).toBe(0);
    expect(prompter.hidden).toEqual([MESSAGES.askKey]);
    expect(prompter.shown).toContain(MESSAGES.problems.bos_url);
    expect(prompter.shown).toContain(MESSAGES.testOk);
    expect(prompter.shown).toContain(MESSAGES.tallyNotOpen(1));
    expect(prompter.shown.join('\n')).not.toContain(KEY);
    await expect(readConfig(path, env)).resolves.toEqual({
      bosUrl: bos.url,
      connectorId: CONNECTOR_ID,
      key: KEY,
      companies: [
        { name: 'Shakti Supreme Pvt Ltd', entityCode: 'SS' },
        { name: 'Shakti Motor Pumps', entityCode: 'SMP' },
      ],
    });
    expect(bos.heartbeats).toEqual([
      {
        connectorVersion: '0.1.0',
        tallyVersion: 'TallyPrime 5.1',
        companies: [
          { name: 'Shakti Supreme Pvt Ltd', lastAlterId: 0, reachable: true },
          { name: 'Shakti Motor Pumps', lastAlterId: 0, reachable: false },
        ],
        queueDepth: 0,
      },
    ]);
  });

  it('says plainly when the BOS refuses the key, and writes nothing for a bad answer', async () => {
    const path = join(dir.dir, 'connector.settings');
    const wrongKey = scripted([
      bos.url,
      CONNECTOR_ID,
      `${KEY}-but-not-this-one`,
      'Shakti Supreme Pvt Ltd',
      'SS',
      '',
    ]);
    await expect(
      runSetup({
        prompter: wrongKey,
        configPath: path,
        env,
        tallyUrl: tally.url,
        log: createMemoryLog(),
      }),
    ).resolves.toBe(1);
    expect(wrongKey.shown).toContain(MESSAGES.testRefused);

    const other = join(dir.dir, 'other.settings');
    const short = scripted([bos.url, CONNECTOR_ID, 'short', 'Shakti Supreme Pvt Ltd', 'SS', '']);
    await expect(
      runSetup({
        prompter: short,
        configPath: other,
        env,
        tallyUrl: tally.url,
        log: createMemoryLog(),
      }),
    ).resolves.toBe(1);
    expect(short.shown).toContain(MESSAGES.problems.key);
    expect(() => readFileSync(other)).toThrow();
  });
});
