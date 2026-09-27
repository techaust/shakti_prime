// The stylesheet every print template shares: Inter embedded from files in this folder (no
// font service is reached while rendering) and the light theme's tokens only, because printed
// and shared documents are always light (DESIGN.md §1 rule 6, §6 Print templates).
import { readFileSync } from 'node:fs';
import { colors, resolve, scale, type ColorToken } from '@shakti/tokens';

// Inter (rsms/inter), SIL Open Font License 1.1: the same variable font, with the weight and
// optical-size axes, that next/font serves to the app; the Latin and Latin Extended subsets
// (Latin Extended carries the rupee sign).
const FONT_FILES = [
  {
    file: 'inter-latin.woff2',
    range:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
  {
    file: 'inter-latin-ext.woff2',
    range:
      'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
] as const;

let fontCss: string | undefined;

/** `@font-face` rules with the font files inlined as data URLs. Read once per process. */
export function interFontFaces(): string {
  fontCss ??= FONT_FILES.map(({ file, range }) => {
    const data = readFileSync(new URL(`./fonts/${file}`, import.meta.url)).toString('base64');
    return `@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range};}`;
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

/** Base rules shared by the quote and the labels. */
export function baseCss(): string {
  const f = scale.font;
  return `
${interFontFaces()}
:root{${lightTokens()}color-scheme:light;}
*{box-sizing:border-box;}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;font-size:${px(f['body-dense'].size)};line-height:${px(f['body-dense'].line)};font-optical-sizing:auto;}
h1,h2,h3{margin:0;font-weight:${f.h1.weight};}
.num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;}
.muted{color:var(--text-muted);}
`;
}
