// Builds the connector as one executable with Node's single executable applications
// (docs/03-roadmap-appendix/phase5.md §2 question 1 and §6.2), on the Windows CI runner
// (.github/workflows/tally-connector.yml) or on any machine for a try-out:
//   1. bundles src/main.ts and @shakti/contracts into one CommonJS file with esbuild;
//   2. makes the SEA blob from packaging/sea-config.json;
//   3. copies this Node and injects the blob with postject 1.0.0-alpha.6;
//   4. runs the result's `version` and checks it answers the connector's version.
// The executable lands in apps/tally-connector/dist/. Run from anywhere:
//   node apps/tally-connector/packaging/build-sea.ts
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'postject';

const app = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(app, 'dist');
const windows = process.platform === 'win32';
const executable = join(dist, windows ? 'shakti-tally-connector.exe' : 'shakti-tally-connector');
/** The fuse Node's single executable looks for (Node's documentation, "Single executable applications"). */
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. One CommonJS file: a single executable runs one script and loads no file beside it.
const bundled = await build({
  entryPoints: [join(app, 'src', 'main.ts')],
  outfile: join(dist, 'connector.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  legalComments: 'none',
  logLevel: 'warning',
});
if (bundled.errors.length > 0) process.exit(1);

// 2. The blob, from the paths in sea-config.json (relative to the app's folder).
execFileSync(
  process.execPath,
  ['--experimental-sea-config', join('packaging', 'sea-config.json')],
  {
    cwd: app,
    stdio: 'inherit',
  },
);

// 3. This Node, with the blob injected.
copyFileSync(process.execPath, executable);
await inject(executable, 'NODE_SEA_BLOB', readFileSync(join(dist, 'sea-prep.blob')), {
  sentinelFuse: SEA_FUSE,
  ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
});

// 4. The executable answers its version.
const version = execFileSync(executable, ['version'], { encoding: 'utf8' }).trim();
const expected = /CONNECTOR_VERSION = '([^']+)'/.exec(
  readFileSync(join(app, 'src', 'settings.ts'), 'utf8'),
)?.[1];
if (version !== expected) {
  process.stderr.write(`the executable answered ${version}, not ${String(expected)}\n`);
  process.exit(1);
}
process.stderr.write(`built ${executable} (${version})\n`);
