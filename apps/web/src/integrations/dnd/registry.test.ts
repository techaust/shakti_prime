import { DndRegistryUnavailable, FIXTURE_DND_NUMBERS } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { dndRegistry } from './registry';

const listed = FIXTURE_DND_NUMBERS[0] ?? '';
const hosted = (environment: string | undefined): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  ...(environment === undefined ? {} : { BOS_ENVIRONMENT: environment }),
});

describe('the DND register of each runtime (question 13)', () => {
  it('asks the fixture register locally, in tests and in CI', async () => {
    for (const env of [{ NODE_ENV: 'test' }, { NODE_ENV: 'development' }] as NodeJS.ProcessEnv[]) {
      expect((await dndRegistry(env).check(listed)).onDnd).toBe(true);
    }
    const journeys: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      BOS_ENVIRONMENT: 'local',
      BETTER_AUTH_URL: 'http://localhost:3000',
    };
    expect((await dndRegistry(journeys).check(listed)).onDnd).toBe(true);
  });

  it('asks the fixture register on dev and staging', async () => {
    for (const environment of ['dev', 'staging']) {
      expect((await dndRegistry(hosted(environment)).check(listed)).onDnd).toBe(true);
    }
  });

  it('has none on production, or on a hosted runtime that names no known environment', async () => {
    for (const environment of ['production', undefined, 'local']) {
      await expect(dndRegistry(hosted(environment)).check(listed)).rejects.toBeInstanceOf(
        DndRegistryUnavailable,
      );
    }
  });
});
