// The stylesheet every print template shares: Inter embedded from files in this folder (no
// font service is reached while rendering) and the light theme's tokens only, because printed
// and shared documents are always light (docs/08-design-system.md §1 rule 6, §6 Print templates).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { colors, resolve, scale, type ColorToken } from '@shakti/tokens';

// Inter 4.1 (rsms/inter), SIL Open Font License 1.1: the static Regular, Medium and SemiBold
// files of the release, which Chromium embeds in a PDF as TrueType (the variable font is drawn as
// Type 3). Each covers a band of weights, so the type scale's 510 and 590 land on Medium and
// SemiBold rather than on the next heavier file (docs/04-architecture-appendix/print.md).
const FONT_FILES = [
  { file: 'Inter-Regular.woff2', weight: '1 449' },
  { file: 'Inter-Medium.woff2', weight: '450 549' },
  { file: 'Inter-SemiBold.woff2', weight: '550 1000' },
] as const;

let fontCss: string | undefined;

/**
 * Where the font files are: under the app's own folder, which every runner of the templates starts
 * in (the server, the tests, the scripts). A path from the module's own address would point into
 * the server's build output instead; on Vercel the render route carries the folder with it
 * (`outputFileTracingIncludes` in next.config.ts).
 */
export const FONTS_DIR = join('src', 'print', 'fonts');

/** `@font-face` rules with the font files inlined as data URLs. Read once per process. */
export function interFontFaces(): string {
  fontCss ??= FONT_FILES.map(({ file, weight }) => {
    const data = readFileSync(join(process.cwd(), FONTS_DIR, file)).toString('base64');
    return `@font-face{font-family:Inter;font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  }).join('\n');
  return fontCss;
}

/** The light theme's colour tokens as CSS variables, generated from `@shakti/tokens`. */
export function lightTokens(): string {
  const values = resolve('light');
  return Object.entries(values)
    .map(([name, value]) => `--${name}:${value};`)
    .join('');
}

/** A token's light value, for places that cannot read a CSS variable (the QR code). */
export function lightColor(name: ColorToken): string {
  return colors[name].light;
}

const px = (n: number) => `${n}px`;

/**
 * How a template gets Inter: embedded from the files in this folder (every printed document), or
 * left to the viewer's own fonts, for an on-screen preview inside the app, whose policy lets a
 * page load fonts only from the app itself and whose server need not read the font files.
 */
export interface TemplateOptions {
  fonts?: 'embedded' | 'viewer';
}

/** Base rules shared by the quote and the labels. */
export function baseCss(options: TemplateOptions = {}): string {
  const f = scale.font;
  return `
${options.fonts === 'viewer' ? '' : interFontFaces()}
:root{${lightTokens()}color-scheme:light;}
*{box-sizing:border-box;}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;font-size:${px(f['body-dense'].size)};line-height:${px(f['body-dense'].line)};font-optical-sizing:auto;}
h1,h2,h3{margin:0;font-weight:${f.h1.weight};}
.num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;}
.muted{color:var(--text-muted);}
`;
}
