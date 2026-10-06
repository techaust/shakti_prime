// Copy lint CLI (docs/08-design-system.md §11.4). Exit code 1 on any issue so CI fails.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCatalogues, checkString, flatten, type Issue, type LengthLimit } from './rules';

interface Config {
  catalogues: { dir: string; locales: string[] }[];
  templateDirs: string[];
  limits: LengthLimit[];
}

const toolDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(toolDir, '..', '..');
const config = JSON.parse(readFileSync(join(toolDir, 'copy-lint.config.json'), 'utf8')) as Config;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function* jsonFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonFiles(full);
    else if (entry.name.endsWith('.json')) yield full;
  }
}

const findings: { file: string; issue: Issue }[] = [];

for (const catalogue of config.catalogues) {
  const dir = join(repoRoot, catalogue.dir);
  const catalogues = new Map<string, Map<string, string>>();
  for (const locale of catalogue.locales) {
    const file = join(dir, `${locale}.json`);
    if (!existsSync(file)) {
      findings.push({
        file: relative(repoRoot, file),
        issue: { key: '*', locale, reason: 'catalogue file missing' },
      });
      continue;
    }
    catalogues.set(locale, flatten(readJson(file)));
  }
  for (const issue of checkCatalogues(catalogues, config.limits)) {
    findings.push({ file: relative(repoRoot, join(dir, `${issue.locale}.json`)), issue });
  }
}

for (const templateDir of config.templateDirs) {
  // A configured folder that is not there would be skipped in silence, leaving nothing checked.
  if (!existsSync(join(repoRoot, templateDir))) {
    findings.push({
      file: templateDir,
      issue: { key: '*', locale: '*', reason: 'configured template folder is missing' },
    });
    continue;
  }
  for (const file of jsonFiles(join(repoRoot, templateDir))) {
    for (const [key, value] of flatten(readJson(file))) {
      for (const issue of checkString(key, value, 'template', config.limits)) {
        findings.push({ file: relative(repoRoot, file), issue });
      }
    }
  }
}

if (findings.length > 0) {
  for (const { file, issue } of findings) {
    console.error(`${file}: ${issue.key} [${issue.locale}]: ${issue.reason}`);
  }
  console.error(`copy-lint: ${findings.length} issue(s)`);
  process.exit(1);
}
console.log('copy-lint: catalogues and templates are clean');
