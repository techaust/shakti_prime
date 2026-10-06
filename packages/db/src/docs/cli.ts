import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources, renderDataDocs } from './data-docs';
import { renderEventsDoc } from './events-docs';

// `pnpm db:docs`: regenerates docs/data/erd.md, docs/data/data-dictionary.md and docs/data/events.md.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const { erd, dictionary } = renderDataDocs(readSources(repoRoot));
const folder = join(repoRoot, 'docs', 'data');
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, 'erd.md'), erd);
writeFileSync(join(folder, 'data-dictionary.md'), dictionary);
writeFileSync(join(folder, 'events.md'), renderEventsDoc());
process.stdout.write(
  'wrote docs/data/erd.md, docs/data/data-dictionary.md and docs/data/events.md\n',
);
