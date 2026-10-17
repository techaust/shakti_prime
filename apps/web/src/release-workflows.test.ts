import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

function bash(code: string, env: Record<string, string>): number | null {
  // Only PATH from this machine, so no variable of the test run reaches the step.
  const given: Record<string, string | undefined> = { PATH: process.env.PATH, ...env };
  return spawnSync('bash', ['-e', '-c', code], { env: given as NodeJS.ProcessEnv }).status;
}

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

  it('starts only a Vercel deploy hook', () => {
    const deploy = script(RELEASE, 'Deploy').replace(/\n\s*curl [^\n]*\n/, '\n');
    expect(bash(deploy, { HOOK: '' })).toBe(1);
    expect(bash(deploy, { HOOK: 'https://example.in/v1/integrations/deploy/prj_x/y' })).toBe(1);
    expect(bash(deploy, { HOOK: 'https://api.vercel.com/v1/integrations/deploy/prj_x/y' })).toBe(0);
  });
});
