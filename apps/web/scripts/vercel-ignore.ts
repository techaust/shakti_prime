// Vercel's Ignored Build Step for the three projects (`ignoreCommand` in apps/web/vercel.json):
// dev and staging build every push, and production builds only a commit an approved release has
// marked (the owner's decision of 15-10-2026; docs/runbooks/deploy.md §2). The release workflow
// (.github/workflows/release.yml) tags the commit `release-<run number>` once the owner has
// approved the run and production is migrated, then starts the production project's deploy hook;
// a push to main, a preview of a branch or a hook started without a release finds no tag and is
// skipped.
//
// Vercel runs the command in the project's root (apps/web) before installing anything, so this
// file uses Node's own modules only and runs as TypeScript on the project's Node 24. It exits with
// BUILD to build; `vercel.json` turns every other ending (a skip, a crash, a missing file) into a
// skip, so production fails closed. Locally: `node scripts/vercel-ignore.ts; echo $?`.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The exit code that asks Vercel to build; `vercel.json` maps it to 1 and everything else to 0. */
export const BUILD = 10;
export const SKIP = 0;

/** The production project's domain (DECISIONS, 15-10-2026). */
export const PRODUCTION_HOST = 'shaktiprime.com';
const COMMIT = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9_.-]+$/;
const RELEASE_TAG = /^refs\/tags\/release-[0-9]+(\^\{\})?$/;

/** The build's variables; `process.env` at run time. */
export type Env = Readonly<Record<string, string | undefined>>;

export interface Decision {
  build: boolean;
  reason: string;
}

/** The commits the repository's release tags point at, read with `git ls-remote`. */
export type ReleasedCommits = (repository: string) => ReadonlySet<string>;

function hostOf(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/:].*$/, '');
}

/**
 * Production is told apart twice, so a missing variable never lets it build every push: by its own
 * name for itself (`BOS_ENVIRONMENT`, set on the Production target only) and by the domain Vercel
 * serves it at (`VERCEL_PROJECT_PRODUCTION_URL`, a system variable every build has, previews too).
 */
export function isProductionProject(env: Env): boolean {
  const host = hostOf(env.VERCEL_PROJECT_PRODUCTION_URL);
  return (
    env.BOS_ENVIRONMENT === 'production' ||
    host === PRODUCTION_HOST ||
    host.endsWith(`.${PRODUCTION_HOST}`)
  );
}

export function decide(env: Env, released: ReleasedCommits): Decision {
  if (!isProductionProject(env)) {
    return { build: true, reason: 'dev and staging build every push' };
  }
  if (env.VERCEL_ENV !== 'production') {
    return { build: false, reason: 'production builds no previews' };
  }
  if (env.VERCEL_GIT_COMMIT_REF !== 'main') {
    return { build: false, reason: 'production builds main only' };
  }
  const commit = env.VERCEL_GIT_COMMIT_SHA ?? '';
  const owner = env.VERCEL_GIT_REPO_OWNER ?? '';
  const slug = env.VERCEL_GIT_REPO_SLUG ?? '';
  if (!COMMIT.test(commit) || !NAME.test(owner) || !NAME.test(slug)) {
    return { build: false, reason: 'Vercel named no commit or repository to check' };
  }
  const repository = `https://github.com/${owner}/${slug}.git`;
  if (!released(repository).has(commit)) {
    return {
      build: false,
      reason: `no approved release names ${commit}; production deploys by a release (release.yml)`,
    };
  }
  return { build: true, reason: `an approved release names ${commit}` };
}

/** Reads `git ls-remote --tags` output: one `<commit>\t<ref>` line per tag. */
export function releasedCommitsFrom(listing: string): ReadonlySet<string> {
  const commits = new Set<string>();
  for (const line of listing.split('\n')) {
    const [commit = '', ref = ''] = line.trim().split('\t');
    if (COMMIT.test(commit) && RELEASE_TAG.test(ref)) commits.add(commit);
  }
  return commits;
}

const gitReleasedCommits: ReleasedCommits = (repository) =>
  releasedCommitsFrom(
    execFileSync('git', ['ls-remote', '--tags', repository, 'refs/tags/release-*'], {
      encoding: 'utf8',
      timeout: 30_000,
    }),
  );

function main(): void {
  let decision: Decision;
  try {
    decision = decide(process.env, gitReleasedCommits);
  } catch (error) {
    decision = { build: false, reason: `the release check failed: ${String(error)}` };
  }
  console.log(`${decision.build ? 'Building' : 'Skipping the build'}: ${decision.reason}.`);
  process.exitCode = decision.build ? BUILD : SKIP;
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
