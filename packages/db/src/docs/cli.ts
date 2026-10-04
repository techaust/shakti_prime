import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources, renderDataDocs } from './data-docs';
import { renderEventsDoc } from './events-docs';

// `pnpm db:docs`: regenerates docs/data/ERD.md, docs/data/DATA-DICTIONARY.md and docs/data/EVENTS.md.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const { erd, dictionary } = renderDataDocs(readSources(repoRoot));
const folder = join(repoRoot, 'docs', 'data');
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, 'ERD.md'), erd);
writeFileSync(join(folder, 'DATA-DICTIONARY.md'), dictionary);
writeFileSync(join(folder, 'EVENTS.md'), renderEventsDoc());
process.stdout.write(
  'wrote docs/data/ERD.md, docs/data/DATA-DICTIONARY.md and docs/data/EVENTS.md\n',
);
