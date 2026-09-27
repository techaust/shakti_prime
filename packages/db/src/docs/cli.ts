import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources, renderDataDocs } from './data-docs';

// `pnpm db:docs`: regenerates docs/data/ERD.md and docs/data/DATA-DICTIONARY.md.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const { erd, dictionary } = renderDataDocs(readSources(repoRoot));
const folder = join(repoRoot, 'docs', 'data');
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, 'ERD.md'), erd);
writeFileSync(join(folder, 'DATA-DICTIONARY.md'), dictionary);
process.stdout.write('wrote docs/data/ERD.md and docs/data/DATA-DICTIONARY.md\n');
