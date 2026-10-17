import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILD,
  decide,
  EVERY_PUSH_PROJECTS,
  looksLikeProduction,
  releasedCommitsFrom,
  SKIP,
  type Env,
  type ReleasedCommits,
} from './vercel-ignore';

// Production deploys only a commit an approved release has marked (owner, 15-10-2026); dev and
// staging deploy every push to main, as before. Only the dev and staging projects, by their ids,
// build every push, so a build missing its variables is held to the release rule.

const web = fileURLToPath(new URL('../', import.meta.url));
const COMMIT = '485a43eb0c1f6d2e9b7a3c5d8e1f2a4b6c9d0e7f';
const OTHER = 'fe9d5fff0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const [DEV_ID = '', STAGING_ID = ''] = [...EVERY_PUSH_PROJECTS.keys()];
/** A project id the gate does not know; the production project's is not written down here. */
const PRODUCTION_ID = 'prj_productionProjectNotListed00';

/** What Vercel sets for a build of the production project's `main` (its production target). */
const PRODUCTION: Env = {
  VERCEL_PROJECT_ID: PRODUCTION_ID,
  BOS_ENVIRONMENT: 'production',
  VERCEL_PROJECT_PRODUCTION_URL: 'shaktiprime.com',
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_REF: 'main',
  VERCEL_GIT_COMMIT_SHA: COMMIT,
  VERCEL_GIT_REPO_OWNER: 'techaust',
  VERCEL_GIT_REPO_SLUG: 'shakti_prime',
};

/** Production's own name and domain taken away, so only the project id speaks. */
const noSigns: Env = { BOS_ENVIRONMENT: undefined, VERCEL_PROJECT_PRODUCTION_URL: undefined };

const releases =
  (...commits: string[]): ReleasedCommits =>
  () =>
    new Set(commits);
const unreachable: ReleasedCommits = () => {
  throw new Error('the tags were read for a build that needs none');
};

describe('the production build gate', () => {
  it('builds every push on dev and staging, known by their ids, without reading the tags', () => {
    expect([...EVERY_PUSH_PROJECTS.values()]).toEqual(['dev', 'staging']);
    for (const env of [
      { VERCEL_PROJECT_ID: DEV_ID, BOS_ENVIRONMENT: 'dev', VERCEL_ENV: 'production' },
      { VERCEL_PROJECT_ID: STAGING_ID, VERCEL_ENV: 'production' },
      // A preview of a branch: the project's own variables are on its production target only.
      { VERCEL_PROJECT_ID: DEV_ID, VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/x' },
      // Every variable but the id missing.
      { VERCEL_PROJECT_ID: STAGING_ID },
    ]) {
      expect(decide(env, unreachable).build).toBe(true);
    }
    expect(decide({ VERCEL_PROJECT_ID: DEV_ID }, unreachable).reason).toBe('dev builds every push');
  });

  it('skips a build with no variables at all, so production fails closed', () => {
    expect(decide({}, unreachable).build).toBe(false);
    // Without the system variables Vercel names no environment, branch or commit either.
    expect(decide({ BOS_ENVIRONMENT: 'production' }, unreachable).build).toBe(false);
  });

  it('holds every project it does not know to the release rule', () => {
    for (const id of [PRODUCTION_ID, '', 'constructor', '__proto__']) {
      const env = { ...PRODUCTION, ...noSigns, VERCEL_PROJECT_ID: id };
      expect(decide(env, releases()).build).toBe(false);
      expect(decide(env, releases(COMMIT)).build).toBe(true);
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

  it("holds a dev or staging id to the release rule when it shows production's name or domain", () => {
    for (const sign of [
      { BOS_ENVIRONMENT: 'production' },
      { VERCEL_PROJECT_PRODUCTION_URL: 'shaktiprime.com' },
    ]) {
      const env = { ...PRODUCTION, ...noSigns, ...sign, VERCEL_PROJECT_ID: DEV_ID };
      expect(decide(env, releases()).build).toBe(false);
      expect(decide(env, releases(COMMIT)).build).toBe(true);
    }
    for (const url of ['shaktiprime.com', 'https://shaktiprime.com/', 'www.shaktiprime.com']) {
      expect(looksLikeProduction({ VERCEL_PROJECT_PRODUCTION_URL: url })).toBe(true);
    }
    for (const url of ['notshaktiprime.com', 'shaktiprime.com.example.in', '']) {
      expect(looksLikeProduction({ VERCEL_PROJECT_PRODUCTION_URL: url })).toBe(false);
    }
  });

  it.each([
    ['a preview', { VERCEL_ENV: 'preview' }],
    ['another branch', { VERCEL_GIT_COMMIT_REF: 'feat/g1-production' }],
    ['no commit', { VERCEL_GIT_COMMIT_SHA: '' }],
    ['a short commit', { VERCEL_GIT_COMMIT_SHA: COMMIT.slice(0, 7) }],
    ['no repository', { VERCEL_GIT_REPO_OWNER: '' }],
    ['a repository name with a path in it', { VERCEL_GIT_REPO_SLUG: 'shakti_prime/../x' }],
    ['another repository, a fork', { VERCEL_GIT_REPO_OWNER: 'someone-else' }],
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

  it('builds dev and staging, and skips a production preview and a build with no variables', () => {
    expect(vercelWould({ VERCEL_PROJECT_ID: DEV_ID })).toBe(1);
    expect(vercelWould({ VERCEL_PROJECT_ID: STAGING_ID })).toBe(1);
    expect(vercelWould({ ...PRODUCTION, VERCEL_ENV: 'preview' })).toBe(0);
    expect(vercelWould({})).toBe(0);
  });

  it('skips when the gate cannot run at all, so production fails closed', () => {
    const missing = (command ?? '').replace('vercel-ignore.ts', 'no-such-file.ts');
    expect(vercelWould({ BOS_ENVIRONMENT: 'production' }, missing)).toBe(0);
    expect(vercelWould({ VERCEL_PROJECT_ID: DEV_ID }, missing)).toBe(0);
  });
});
