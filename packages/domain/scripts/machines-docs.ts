// Writes the state-machine specifications into docs/state-machines (BLUEPRINT §19 item 2).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAll } from '../src/state-machines/render';

const out = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/state-machines');
const files = renderAll();

mkdirSync(out, { recursive: true });
// A machine that was renamed or removed leaves no stale document behind.
for (const name of readdirSync(out)) {
  if (name.endsWith('.md') && !files.has(name)) rmSync(join(out, name));
}
for (const [name, content] of files) writeFileSync(join(out, name), content);
console.warn(`state machines: wrote ${String(files.size)} files to docs/state-machines`);
