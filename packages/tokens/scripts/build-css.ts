import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTailwindCss, renderTokensCss } from '../src/css';
import { renderAppIcon } from '../src/icon';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
writeFileSync(join(src, 'tokens.css'), renderTokensCss());
writeFileSync(join(src, 'tailwind.css'), renderTailwindCss());
// The web app's browser-tab icon carries the accent, so it is generated here as well.
writeFileSync(join(root, '..', '..', 'apps', 'web', 'src', 'app', 'icon.svg'), renderAppIcon());
console.log('tokens: wrote src/tokens.css, src/tailwind.css and apps/web/src/app/icon.svg');
