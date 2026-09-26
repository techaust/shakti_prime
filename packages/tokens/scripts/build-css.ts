import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTailwindCss, renderTokensCss } from '../src/css';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
writeFileSync(join(src, 'tokens.css'), renderTokensCss());
writeFileSync(join(src, 'tailwind.css'), renderTailwindCss());
console.log('tokens: wrote src/tokens.css and src/tailwind.css');
