import { describe, expect, it } from 'vitest';
import { memoryKeyValue } from '../ports/key-value';
import { bumpPlaybookVersion, PLAYBOOK_VERSION_KEY, playbookVersion } from './playbook-version';

describe('the Playbook version', () => {
  it('is absent until the first change, then a new id at every change', async () => {
    const keyValue = memoryKeyValue();
    expect(await playbookVersion(keyValue)).toBeNull();
    const first = await bumpPlaybookVersion(keyValue);
    expect(await playbookVersion(keyValue)).toBe(first);
    const second = await bumpPlaybookVersion(keyValue);
    expect(second).not.toBe(first);
    expect(await keyValue.get(PLAYBOOK_VERSION_KEY)).toBe(second);
  });
});
