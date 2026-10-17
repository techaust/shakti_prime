import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The ways into production (G1; docs/14-reviews/2026-09-audit.md M45): the migrate workflow's
// production choice and the release workflow both wait for the owner in the GitHub environment
// `production`, run from main only and reach the production project alone. The workflows run on
// GitHub, so these tests read their text and run their shell steps with the values a run would
// give them.

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');
const MIGRATE = read('.github/workflows/migrate.yml');
const RELEASE = read('.github/workflows/release.yml');
const ACTION = read('.github/actions/migrate-database/action.yml');
const PRODUCTION_REF = 'ifnoytyhnedgiyhxxhhu';

/** The lines of a job, from `  <name>:` to the next job. */
function job(workflow: string, name: string): string {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  expect(start).toBeGreaterThan(0);
  const end = lines.findIndex((line, i) => i > start && /^ {2}[a-z-]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** The script of the step named `name`: its `run: |` block, without its indentation. */
function script(text: string, name: string): string {
  const lines = text.split('\n');
  const step = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  expect(step).toBeGreaterThanOrEqual(0);
  const run = lines.findIndex((line, i) => i > step && line.trim() === 'run: |');
  const indent = (lines[run + 1] ?? '').search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && line.search(/\S/) < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

/** Runs a step's script as GitHub does (`bash -e`); `stdout` is what it printed. */
function run(code: string, env: Record<string, string>): { status: number | null; stdout: string } {
  // Only PATH from this machine, so no variable of the test run reaches the step.
  const given: Record<string, string | undefined> = { PATH: process.env.PATH, ...env };
  const result = spawnSync('bash', ['-e', '-c', code], {
    env: given as NodeJS.ProcessEnv,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout };
}

function bash(code: string, env: Record<string, string>): number | null {
  return run(code, env).status;
}

const SHA = '485a43eb0c1f6d2e9b7a3c5d8e1f2a4b6c9d0e7f';
const EARLIER = 'ad0e3d2e0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const OLDER = 'fe9d5fff0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const STRAY = '93d9ceaf0a1b2c3d4e5f60718293a4b5c6d7e8f9';

/**
 * Stand-ins for `gh`, `curl`, `jq` and `sleep`, as shell functions ahead of a step's script, so no
 * case reaches GitHub or a site. `gh api <path>` answers what its filter would have given: the
 * migrate runs (`FAKE_RUNS`, "<id> <commit>" lines), whether a run migrated staging (the ids in
 * `FAKE_STAGED`), the comparison with `FAKE_BASE` (`FAKE_COMPARE`: status, files listed, migration
 * files) and the release tags' commits (`FAKE_TAGS`). `curl` prints `FAKE_SERVED`; `jq` passes it on.
 */
const FAKES = [
  'gh() {',
  '  case "$2" in',
  `    */actions/workflows/migrate.yml/runs*) printf '%s\\n' "$FAKE_RUNS" ;;`,
  '    */actions/runs/*/jobs)',
  '      id=$(basename "$(dirname "$2")")',
  '      case " $FAKE_STAGED " in *" $id "*) echo 1 ;; *) echo 0 ;; esac ;;',
  '    */compare/*)',
  '      [ "$2" = "repos/$REPO/compare/$FAKE_BASE...$SHA" ] || return 1',
  `      printf '%s\\n' "$FAKE_COMPARE" ;;`,
  `    */matching-refs/tags/release-) printf '%s\\n' "$FAKE_TAGS" ;;`,
  '    *) return 1 ;;',
  '  esac',
  '}',
  `curl() { printf '%s' "$FAKE_SERVED"; }`,
  'jq() { cat; }',
  'sleep() { :; }',
].join('\n');

/** A step's script with the stand-ins ahead of it. */
const faked = (text: string, name: string): string => `${FAKES}\n${script(text, name)}`;

describe('the migrate workflow', () => {
  it('offers production beside dev and staging', () => {
    expect(MIGRATE).toContain('options: [dev, staging, production]');
  });

  it('refuses any ref but main before production asks for approval', () => {
    const guard = script(MIGRATE, 'Only from main');
    expect(bash(guard, { REF: 'refs/heads/main' })).toBe(0);
    for (const ref of ['refs/heads/feat/g1-production', 'refs/tags/release-1', '']) {
      expect(bash(guard, { REF: ref })).toBe(1);
    }
    expect(job(MIGRATE, 'migrate')).toContain('needs: guard');
    expect(job(MIGRATE, 'migrate-production')).toContain('needs: guard');
  });

  it('migrates production in its environment, with its own secrets and project', () => {
    const production = job(MIGRATE, 'migrate-production');
    expect(production).toContain(
      "if: inputs.environment == 'production' && github.ref == 'refs/heads/main'",
    );
    expect(production).toMatch(/\n {4}environment: production\n/);
    expect(production).toContain(`project-ref: ${PRODUCTION_REF}`);
    expect(production).toContain('group: production');
    for (const name of [
      'DATABASE_URL_MIGRATOR',
      'APP_USER_PASSWORD',
      'AUTH_SERVICE_PASSWORD',
      'OUTBOX_PUBLISHER_PASSWORD',
      'DATABASE_CA_CERT',
      'APP_READER_PASSWORD',
      'APP_BACKUP_PASSWORD',
    ]) {
      expect(production).toContain(`\${{ secrets.${name} }}`);
    }
    expect(production).toContain('rotate-passwords: ${{ inputs.rotate_passwords }}');
    // Dev and staging never read the environment's secrets, nor production the suffixed ones.
    expect(job(MIGRATE, 'migrate')).not.toMatch(/secrets\.[A-Z]/);
    expect(production).not.toContain('format(');
    expect(job(MIGRATE, 'migrate')).toContain(
      "if: inputs.environment == 'dev' || inputs.environment == 'staging'",
    );
  });

  it('keeps no credentials after a checkout', () => {
    for (const text of [MIGRATE, RELEASE]) {
      const checkouts = text.split('uses: actions/checkout@').length - 1;
      expect(checkouts).toBeGreaterThan(0);
      expect(text.split('persist-credentials: false').length - 1).toBe(checkouts);
    }
  });
});

describe('the migration action', () => {
  const check = script(ACTION, 'Secrets present and for this project');
  const secrets = {
    APP_USER_PASSWORD: 'value',
    AUTH_SERVICE_PASSWORD: 'value',
    OUTBOX_PUBLISHER_PASSWORD: 'value',
    DATABASE_CA_CERT: 'value',
    ENVIRONMENT: 'production',
    PROJECT_REF: PRODUCTION_REF,
    SUFFIX: '',
  };

  it("accepts the project's session pooler and direct addresses", () => {
    for (const url of [
      `postgresql://postgres.${PRODUCTION_REF}:value@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`,
      `postgresql://postgres:value@db.${PRODUCTION_REF}.supabase.co:5432/postgres`,
    ]) {
      expect(bash(check, { ...secrets, DATABASE_URL_MIGRATOR: url })).toBe(0);
    }
  });

  it("refuses staging's address on production, a missing secret and a missing project", () => {
    const staging =
      'postgresql://postgres.azydxxvlboivablvvojp:value@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';
    expect(bash(check, { ...secrets, DATABASE_URL_MIGRATOR: staging })).toBe(1);
    const good = `postgresql://postgres.${PRODUCTION_REF}:value@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`;
    expect(bash(check, { ...secrets, DATABASE_URL_MIGRATOR: good, DATABASE_CA_CERT: '' })).toBe(1);
    expect(bash(check, { ...secrets, DATABASE_URL_MIGRATOR: good, PROJECT_REF: '' })).toBe(1);
    expect(bash(check, { ...secrets, DATABASE_URL_MIGRATOR: '' })).toBe(1);
  });

  it('migrates, verifies and seeds, in that order', () => {
    const order = ['pnpm db:migrate', 'pnpm db:verify', 'pnpm db:seed'].map((c) =>
      ACTION.indexOf(c),
    );
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The install runs with no secret in its environment.
    const install = ACTION.indexOf('pnpm install --frozen-lockfile');
    expect(ACTION.slice(install, ACTION.indexOf('- name: Migrate'))).not.toContain('inputs.');
  });

  it('restores no Actions cache into a job that holds a database password', () => {
    expect(ACTION).toContain('package-manager-cache: false');
    expect(ACTION).not.toMatch(/\n\s*cache:/);
    expect(ACTION).not.toContain('actions/cache');
  });
});

describe('the release workflow', () => {
  it('is started by hand only, with no permissions unless a job names them', () => {
    const triggers = RELEASE.slice(RELEASE.indexOf('\non:'), RELEASE.indexOf('\nrun-name:'));
    expect(triggers).toContain('workflow_dispatch:');
    expect(triggers).not.toMatch(/\n {2}(push|pull_request|schedule|workflow_run)/);
    expect(RELEASE).toContain('\npermissions: {}\n');
    expect(RELEASE).toContain(`PROJECT_REF: ${PRODUCTION_REF}`);
    expect(RELEASE).toContain('SITE: https://shaktiprime.com');
  });

  it('refuses any ref but main before asking for approval', () => {
    const guard = script(RELEASE, 'Only from main');
    expect(bash(guard, { REF: 'refs/heads/main' })).toBe(0);
    expect(bash(guard, { REF: 'refs/heads/staging-copy' })).toBe(1);
    const check = job(RELEASE, 'check');
    expect(check).not.toContain('environment:');
    expect(check).not.toContain('secrets.');
  });

  it('changes production only in its environment, after the checks', () => {
    const release = job(RELEASE, 'release');
    expect(release).toContain('needs: check');
    expect(release).toMatch(/\n {4}environment:\n {6}name: production\n/);
    expect(release).toContain('group: production');
    expect(release).toContain('uses: ./.github/actions/migrate-database');
    expect(release).toContain('${{ secrets.VERCEL_DEPLOY_HOOK_PRODUCTION }}');
    // The steps in the order a release needs them.
    const steps = [
      'Main is still this commit',
      'uses: ./.github/actions/migrate-database',
      'Main is still this commit, before the deploy',
      'What production serves now',
      'Mark the commit as released',
      '- name: Deploy',
      'Production serves this commit',
      'Production is ready',
    ].map((step) => release.indexOf(step));
    expect(steps.every((at) => at > 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it('tags the commit with the name the production build gate looks for', () => {
    expect(job(RELEASE, 'release')).toContain('TAG: release-${{ github.run_number }}');
    expect(read('apps/web/scripts/vercel-ignore.ts')).toContain(
      'const RELEASE_TAG = /^refs\\/tags\\/release-[0-9]+(\\^\\{\\})?$/;',
    );
  });

  it('releases only what staging was migrated to first', () => {
    const step = faked(RELEASE, 'Staging is migrated to this commit');
    const given = {
      SHA,
      REPO: 'techaust/shakti_prime',
      FAKE_RUNS: `12 ${EARLIER}\n11 ${OLDER}`,
      FAKE_STAGED: '12',
      FAKE_BASE: EARLIER,
      FAKE_COMPARE: 'ahead 4 0',
    };
    // Migrated from this commit, or from an earlier one with the same migrations.
    const same = { FAKE_RUNS: `12 ${SHA}`, FAKE_BASE: SHA, FAKE_COMPARE: 'identical 0 0' };
    expect(bash(step, { ...given, ...same })).toBe(0);
    expect(bash(step, given)).toBe(0);
    // The newest run migrated dev only: the one before it decides.
    expect(bash(step, { ...given, FAKE_STAGED: '11', FAKE_BASE: OLDER })).toBe(0);
    // Staging never migrated from main, or the migrations changed since.
    expect(bash(step, { ...given, FAKE_RUNS: '' })).toBe(1);
    expect(bash(step, { ...given, FAKE_STAGED: '' })).toBe(1);
    expect(bash(step, { ...given, FAKE_COMPARE: 'ahead 4 1' })).toBe(1);
    // Migrated from a commit that is not an earlier one of this, or GitHub listed its cap.
    expect(bash(step, { ...given, FAKE_COMPARE: 'behind 2 0' })).toBe(1);
    expect(bash(step, { ...given, FAKE_COMPARE: 'diverged 3 0' })).toBe(1);
    expect(bash(step, { ...given, FAKE_COMPARE: 'ahead 300 0' })).toBe(1);
    // GitHub did not answer the comparison.
    expect(bash(step, { ...given, FAKE_BASE: OLDER })).toBe(1);
    expect(job(RELEASE, 'check')).toMatch(/\n {6}actions: read\n {6}contents: read\n/);
  });

  it('notes what production serves before the deploy, and an unreleased commit', () => {
    const step = faked(RELEASE, 'What production serves now');
    const folder = mkdtempSync(join(tmpdir(), 'release-'));
    try {
      // Forward slashes, which Git Bash on Windows reads as well as Linux.
      const githubEnv = join(folder, 'env').replaceAll('\\', '/');
      const given = { REPO: 'techaust/shakti_prime', GITHUB_ENV: githubEnv };
      const written = (): string => readFileSync(githubEnv, 'utf8');

      const tags = `${OLDER}\n${EARLIER}`;
      const released = run(step, { ...given, FAKE_SERVED: EARLIER, FAKE_TAGS: tags });
      expect(released.status).toBe(0);
      expect(written()).toBe(`BEFORE=${EARLIER}\n`);
      expect(released.stdout).not.toContain('::warning::');

      const stray = run(step, { ...given, FAKE_SERVED: STRAY, FAKE_TAGS: EARLIER });
      expect(stray.status).toBe(0);
      expect(written()).toContain(`BEFORE=${STRAY}\n`);
      expect(stray.stdout).toContain(`::warning::Production serves ${STRAY}, which no release`);

      const first = run(step, { ...given, FAKE_SERVED: '', FAKE_TAGS: '' });
      expect(first.status).toBe(0);
      expect(written().endsWith('BEFORE=\n')).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('waits for this commit and stops at once on a commit no release approved', () => {
    const step = faked(RELEASE, 'Production serves this commit');
    expect(bash(step, { SHA, BEFORE: EARLIER, FAKE_SERVED: SHA })).toBe(0);
    const stray = run(step, { SHA, BEFORE: EARLIER, FAKE_SERVED: STRAY });
    expect(stray.status).toBe(1);
    expect(stray.stdout).toContain(`Production serves ${STRAY}, which no release approved`);
    expect(bash(step, { SHA, BEFORE: '', FAKE_SERVED: STRAY })).toBe(1);
    // The commit served before, or no answer, until the wait runs out.
    const waited = run(step, { SHA, BEFORE: EARLIER, FAKE_SERVED: EARLIER });
    expect(waited.status).toBe(1);
    expect(waited.stdout).toContain(`Production does not serve ${SHA} after 20 minutes`);
    expect(bash(step, { SHA, BEFORE: EARLIER, FAKE_SERVED: '' })).toBe(1);
    // The two full waits start a shell per try, which is slow on Windows.
  }, 60_000);

  it('starts only a Vercel deploy hook', () => {
    const deploy = script(RELEASE, 'Deploy').replace(/\n\s*curl [^\n]*\n/, '\n');
    expect(bash(deploy, { HOOK: '' })).toBe(1);
    expect(bash(deploy, { HOOK: 'https://example.in/v1/integrations/deploy/prj_x/y' })).toBe(1);
    expect(bash(deploy, { HOOK: 'https://api.vercel.com/v1/integrations/deploy/prj_x/y' })).toBe(0);
  });
});

describe('the backup workflow (docs/05-database.md §10)', () => {
  const BACKUP = read('.github/workflows/backup.yml');
  // Found by its name, not its number, which moves when main gains migrations first.
  const migration = readdirSync(`${root}packages/db/migrations`).find((f) =>
    f.endsWith('_backup_role.sql'),
  );
  const MIGRATION = read(`packages/db/migrations/${migration ?? 'none'}`);
  const check = script(BACKUP, 'Settings present and for this project');
  const settings = {
    PROJECT_REF: PRODUCTION_REF,
    DATABASE_URL_BACKUP: `postgresql://app_backup.${PRODUCTION_REF}:value@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`,
    DATABASE_CA_CERT: 'value',
    BACKUP_BUCKET: 'shakti-prime-production-backups',
    BACKUP_ROLE_ARN: 'arn:aws:iam::199476069348:role/shakti-prime-production-backup-writer',
  };

  it('runs every 6 hours and by hand, from main, with no permission but its AWS token', () => {
    const triggers = BACKUP.slice(BACKUP.indexOf('\non:'), BACKUP.indexOf('\npermissions:'));
    expect(triggers).toContain("- cron: '23 */6 * * *'");
    expect(triggers).toContain('workflow_dispatch:');
    expect(triggers).not.toMatch(/\n {2}(push|pull_request|workflow_run)/);
    expect(BACKUP).toContain('\npermissions: {}\n');
    const backup = job(BACKUP, 'backup');
    expect(backup).toContain("if: github.ref == 'refs/heads/main'");
    expect(backup).toMatch(/\n {4}permissions:\n(?: {6}#[^\n]*\n)* {6}id-token: write\n {4}steps:/);
  });

  it('runs in its own environment, never production’s, and runs no action at all', () => {
    const backup = job(BACKUP, 'backup');
    expect(backup).toMatch(/\n {4}environment: production-backup\n/);
    expect(BACKUP).not.toMatch(/environment:\s*production\s*\n/);
    expect(BACKUP).not.toContain('uses:');
    // It reads the backup login's address, never the migrator's or a role's password.
    expect(BACKUP).not.toMatch(/secrets\.(DATABASE_URL_MIGRATOR|[A-Z_]*_PASSWORD)/);
  });

  it('accepts the backup login on the production project only', () => {
    expect(bash(check, settings)).toBe(0);
    for (const change of [
      { DATABASE_URL_BACKUP: '' },
      { DATABASE_CA_CERT: '' },
      { BACKUP_BUCKET: '' },
      { BACKUP_ROLE_ARN: '' },
      // The migrator, or the backup login of another project.
      {
        DATABASE_URL_BACKUP: `postgresql://postgres.${PRODUCTION_REF}:value@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`,
      },
      {
        DATABASE_URL_BACKUP:
          'postgresql://app_backup.azydxxvlboivablvvojp:value@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
      },
      { BACKUP_BUCKET: 'shakti-prime-staging-files' },
      { BACKUP_ROLE_ARN: 'arn:aws:iam::199476069348:role/admin' },
    ]) {
      expect(bash(check, { ...settings, ...change })).toBe(1);
    }
  });

  it('copies exactly the schemas the backup login may read', () => {
    const schemas = /\n {2}SCHEMAS: ([a-z_ ]+)\n/.exec(BACKUP)?.[1]?.split(' ') ?? [];
    expect(schemas.length).toBeGreaterThan(3);
    for (const line of MIGRATION.split('\n').filter((l) => / in schema | on schema /.test(l))) {
      expect(line).toContain(schemas.join(', '));
    }
    // A copy is checked before it is kept, and the database's certificate is checked.
    const steps = ['PGSSLMODE=verify-full', 'pg_restore --list', 'aws s3 cp'].map((s) =>
      BACKUP.indexOf(s),
    );
    expect(steps.every((at) => at > 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });
});
