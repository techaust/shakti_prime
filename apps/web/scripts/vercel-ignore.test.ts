import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILD,
  decide,
  isProductionProject,
  releasedCommitsFrom,
  SKIP,
  type Env,
  type ReleasedCommits,
} from './vercel-ignore';

// Production deploys only a commit an approved release has marked (owner, 15-10-2026); dev and
// staging deploy every push to main, as before.

const web = fileURLToPath(new URL('../', import.meta.url));
const COMMIT = '485a43eb0c1f6d2e9b7a3c5d8e1f2a4b6c9d0e7f';
const OTHER = 'fe9d5fff0a1b2c3d4e5f60718293a4b5c6d7e8f9';

/** What Vercel sets for a build of the production project's `main` (its production target). */
const PRODUCTION: Env = {
  BOS_ENVIRONMENT: 'production',
  VERCEL_PROJECT_PRODUCTION_URL: 'shaktiprime.com',
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_REF: 'main',
  VERCEL_GIT_COMMIT_SHA: COMMIT,
  VERCEL_GIT_REPO_OWNER: 'techaust',
  VERCEL_GIT_REPO_SLUG: 'shakti_prime',
};

const releases =
  (...commits: string[]): ReleasedCommits =>
  () =>
    new Set(commits);
const unreachable: ReleasedCommits = () => {
  throw new Error('the tags were read for a build that needs none');
};

describe('the production build gate', () => {
  it('builds every push on dev and staging, without reading the tags', () => {
    for (const env of [
      { BOS_ENVIRONMENT: 'dev', VERCEL_PROJECT_PRODUCTION_URL: 'shakti-prime-dev.vercel.app' },
      {
        BOS_ENVIRONMENT: 'staging',
        VERCEL_PROJECT_PRODUCTION_URL: 'shakti-prime-staging.vercel.app',
      },
      // A preview of a branch: the project's variables are on its production target only.
      { VERCEL_PROJECT_PRODUCTION_URL: 'shakti-prime-dev.vercel.app', VERCEL_ENV: 'preview' },
    ]) {
      expect(decide(env, unreachable).build).toBe(true);
    }
  });

  it('builds production for a commit an approved release tagged', () => {
    expect(decide(PRODUCTION, releases(OTHER, COMMIT))).toEqual({
      build: true,
      reason: `an approved release names ${COMMIT}`,
    });
  });

  it('skips a push to main on production that no release asked for', () => {
    expect(decide(PRODUCTION, releases(OTHER)).build).toBe(false);
    expect(decide(PRODUCTION, releases()).build).toBe(false);
  });

  it('knows production by its domain when its own variables are missing', () => {
    const withoutName = { ...PRODUCTION, BOS_ENVIRONMENT: undefined };
    expect(isProductionProject(withoutName)).toBe(true);
    expect(decide(withoutName, releases()).build).toBe(false);
    for (const url of ['shaktiprime.com', 'https://shaktiprime.com/', 'www.shaktiprime.com']) {
      expect(isProductionProject({ VERCEL_PROJECT_PRODUCTION_URL: url })).toBe(true);
    }
    for (const url of ['notshaktiprime.com', 'shaktiprime.com.example.in', '']) {
      expect(isProductionProject({ VERCEL_PROJECT_PRODUCTION_URL: url })).toBe(false);
    }
  });

  it.each([
    ['a preview', { VERCEL_ENV: 'preview' }],
    ['another branch', { VERCEL_GIT_COMMIT_REF: 'feat/g1-production' }],
    ['no commit', { VERCEL_GIT_COMMIT_SHA: '' }],
    ['a short commit', { VERCEL_GIT_COMMIT_SHA: COMMIT.slice(0, 7) }],
    ['no repository', { VERCEL_GIT_REPO_OWNER: '' }],
    ['a repository name with a path in it', { VERCEL_GIT_REPO_SLUG: 'shakti_prime/../x' }],
  ])('skips production for %s, even with the commit tagged', (_label, change) => {
    expect(decide({ ...PRODUCTION, ...change }, releases(COMMIT)).build).toBe(false);
  });

  it('reads only the release tags of the listing', () => {
    const listing = [
      `${COMMIT}\trefs/tags/release-12`,
      `${OTHER}\trefs/tags/v1.0`,
      `${OTHER}\trefs/tags/release-candidate`,
      `${OTHER}\trefs/heads/release-13`,
      'not a line',
      '',
    ].join('\n');
    expect([...releasedCommitsFrom(listing)]).toEqual([COMMIT]);
    expect([...releasedCommitsFrom(`${OTHER}\trefs/tags/release-3^{}\n`)]).toEqual([OTHER]);
  });
});

describe("vercel.json's ignoreCommand", () => {
  const command = (
    JSON.parse(readFileSync(`${web}vercel.json`, 'utf8')) as { ignoreCommand?: string }
  ).ignoreCommand;

  it('runs the gate and builds only on its BUILD code', () => {
    expect(BUILD).not.toBe(SKIP);
    expect(command).toBe(`node scripts/vercel-ignore.ts; [ $? -ne ${String(BUILD)} ]`);
  });

  // Vercel builds when the command exits 1 and skips when it exits 0. Run through a shell as
  // Vercel does; no case here reaches the network.
  function vercelWould(env: Env, script = command ?? ''): number | null {
    const own = Object.entries(process.env).filter(
      ([name]) => name !== 'BOS_ENVIRONMENT' && !name.startsWith('VERCEL'),
    );
    return spawnSync('sh', ['-c', script], {
      cwd: web,
      env: { ...Object.fromEntries(own), ...env } as NodeJS.ProcessEnv,
    }).status;
  }

  it('builds dev and skips a production preview', () => {
    expect(vercelWould({ BOS_ENVIRONMENT: 'dev' })).toBe(1);
    expect(vercelWould({ ...PRODUCTION, VERCEL_ENV: 'preview' })).toBe(0);
  });

  it('skips when the gate cannot run at all, so production fails closed', () => {
    const missing = (command ?? '').replace('vercel-ignore.ts', 'no-such-file.ts');
    expect(vercelWould({ BOS_ENVIRONMENT: 'production' }, missing)).toBe(0);
  });
});
