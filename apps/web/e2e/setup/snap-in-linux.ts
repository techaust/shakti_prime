// `pnpm --filter web e2e:snap`: the journeys with their screenshots, in the Linux image CI uses.
// The seed has run on the host (`e2e:seed`); this starts the production build on the host when it
// is not already answering, then runs the Playwright runner inside
// mcr.microsoft.com/playwright:v1.63.0-noble against it. Extra arguments go to `playwright test`
// (for example `-- --update-snapshots` to make the baselines, or a spec path).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const IMAGE = 'mcr.microsoft.com/playwright:v1.63.0-noble';
const webDir = resolve(import.meta.dirname, '../..');
const repoDir = resolve(webDir, '../..');
const rootEnv = resolve(repoDir, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const port = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3031').port || '3031';
const health = `http://localhost:${port}/api/v1/health`;

async function answering(): Promise<boolean> {
  try {
    return (await fetch(health)).ok;
  } catch {
    return false;
  }
}

let app: ChildProcess | undefined;
if (!(await answering())) {
  // One command line through the shell, so Windows finds `next`'s launcher on the script's PATH.
  // Elsewhere the server leads its own process group, so the stop below reaches the shell's child.
  // The same stand-in AI transport as playwright.config.ts's own server, so the journeys match.
  app = spawn(`next start -p ${port}`, {
    cwd: webDir,
    env: { ...process.env, BOS_ENVIRONMENT: 'local', AI_TRANSPORT: 'fake' },
    stdio: 'ignore',
    shell: true,
    detached: process.platform !== 'win32',
  });
  const deadline = Date.now() + 120_000;
  while (!(await answering())) {
    if (Date.now() > deadline) throw new Error(`the app did not answer on ${health}`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

// Docker Desktop on Windows wants the drive path with forward slashes. pnpm's links in
// node_modules point at the drive as Docker Desktop sees it (/mnt/host/<drive>/…), so the
// repository is mounted at that same path and the Windows install resolves inside the image.
const mount = repoDir.replaceAll('\\', '/');
const inContainer = /^[A-Za-z]:\//.test(mount)
  ? `/mnt/host/${mount.charAt(0).toLowerCase()}${mount.slice(2)}`
  : mount;
const args = process.argv.slice(2).filter((a) => a !== '--');
const script = [
  'node e2e/setup/forward.mjs &',
  `node node_modules/@playwright/test/cli.js test ${args.map((a) => `'${a}'`).join(' ')}`,
].join(' ');
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--ipc=host',
    '--add-host=host.docker.internal:host-gateway',
    '-v',
    `${mount}:${inContainer}`,
    '-w',
    `${inContainer}/apps/web`,
    '-e',
    'E2E_EXTERNAL_APP=1',
    '-e',
    `E2E_BASE_URL=http://localhost:${port}`,
    '-e',
    `E2E_PORT=${port}`,
    '-e',
    'CI',
    IMAGE,
    'bash',
    '-c',
    script,
  ],
  { stdio: 'inherit' },
);

if (app !== undefined) {
  if (process.platform === 'win32' && app.pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { stdio: 'ignore' });
  } else if (app.pid !== undefined) {
    // The whole group, forcibly: a server that has lost its output can ignore SIGTERM.
    try {
      process.kill(-app.pid, 'SIGKILL');
    } catch {
      // The group has already gone.
    }
  }
}
process.exit(result.status ?? 1);
