// Generates the CSS delivered to the web app (DESIGN.md §8). Pure functions so the
// stale-file test can compare the committed output with a fresh render.
import { aliases, colors, scale, shadows, type Theme } from './tokens';

/** Pixels at the browser default text size, emitted in rem so a user's own setting scales them. */
const rem = (px: number) => `${String(px / 16)}rem`;

const HEADER = '/* Generated from packages/tokens/src/tokens.ts. Do not edit by hand. */\n';

function themeBlock(theme: Theme, indent: string): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(colors))
    lines.push(`${indent}--${name}: ${value[theme]};`);
  for (const [name, value] of Object.entries(shadows))
    lines.push(`${indent}--${name}: ${value[theme]};`);
  lines.push(`${indent}color-scheme: ${theme};`);
  return lines.join('\n');
}

// A custom property's var() resolves on the element that declares it, so a scoped theme block
// must declare the aliases again or they keep the values resolved on :root.
function aliasBlock(indent: string): string {
  return Object.entries(aliases)
    .map(([name, target]) => `${indent}--${name}: var(--${target});`)
    .join('\n');
}

function staticBlock(indent: string): string {
  const lines: string[] = [aliasBlock(indent)];
  for (const [step, px] of Object.entries(scale.space))
    lines.push(`${indent}--space-${step}: ${rem(px)};`);
  for (const [step, px] of Object.entries(scale.radius))
    lines.push(`${indent}--radius-${step}: ${px}px;`);
  for (const [role, font] of Object.entries(scale.font)) {
    lines.push(`${indent}--font-${role}-size: ${rem(font.size)};`);
    lines.push(`${indent}--font-${role}-line: ${rem(font.line)};`);
    lines.push(`${indent}--font-${role}-weight: ${font.weight};`);
  }
  // next/font sets --font-inter on <html>; elsewhere the stack falls back to Inter by name.
  lines.push(`${indent}--font-family: var(--font-inter, Inter), system-ui, sans-serif;`);
  for (const [name, ms] of Object.entries(scale.motion))
    lines.push(`${indent}--motion-${name}: ${ms}ms;`);
  lines.push(`${indent}--row-comfortable: ${rem(scale.row.comfortable)};`);
  lines.push(`${indent}--row-compact: ${rem(scale.row.compact)};`);
  lines.push(`${indent}--control-desktop: ${rem(scale.control.desktop)};`);
  lines.push(`${indent}--control-phone: ${rem(scale.control.phone)};`);
  lines.push(`${indent}--focus-ring-width: ${scale.focusRing.width}px;`);
  lines.push(`${indent}--focus-ring-offset: ${scale.focusRing.offset}px;`);
  lines.push(`${indent}--sidebar-width: ${rem(scale.shell.sidebar)};`);
  lines.push(`${indent}--sidebar-collapsed: ${rem(scale.shell.sidebarCollapsed)};`);
  lines.push(`${indent}--topbar-height: ${rem(scale.shell.topbar)};`);
  lines.push(`${indent}--content-form: ${rem(scale.content.form)};`);
  lines.push(`${indent}--content-detail: ${rem(scale.content.detail)};`);
  return lines.join('\n');
}

/** `tokens.css`: light on :root, dark under the system media query and under an explicit override. */
export function renderTokensCss(): string {
  return [
    HEADER,
    ':root {',
    themeBlock('light', '  '),
    staticBlock('  '),
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    themeBlock('dark', '    '),
    '  }',
    '}',
    '',
    ':root[data-theme="dark"] {',
    themeBlock('dark', '  '),
    '}',
    '',
    '/* Scoped themes, so one page can show both side by side (the /design preview). */',
    '.theme-light {',
    themeBlock('light', '  '),
    aliasBlock('  '),
    '}',
    '',
    '.theme-dark {',
    themeBlock('dark', '  '),
    aliasBlock('  '),
    '}',
    '',
  ].join('\n');
}

/**
 * shadcn/ui names its neutral hover fill `--accent`, which the Shakti indigo already owns. The
 * neutral takes the name `highlight` instead, and `--accent-foreground` is never declared, so a
 * pasted shadcn class `text-accent-foreground` styles nothing and the packages/ui source check
 * (`no-shadcn-accent.test.ts`) catches it; `bg-accent` stays the indigo fill.
 */
const SHADCN_ALIASES: Readonly<Record<string, string>> = {
  background: 'bg',
  foreground: 'text',
  card: 'surface',
  'card-foreground': 'text',
  popover: 'surface',
  'popover-foreground': 'text',
  primary: 'accent',
  'primary-foreground': 'accent-fg',
  secondary: 'surface-2',
  'secondary-foreground': 'text',
  muted: 'surface-2',
  'muted-foreground': 'text-muted',
  highlight: 'surface-3',
  'highlight-foreground': 'text',
  destructive: 'danger',
  'destructive-foreground': 'danger-soft',
  input: 'border-strong',
  ring: 'focus',
};

/** `tailwind.css`: Tailwind v4 theme mapping and the shadcn/ui aliases above. */
export function renderTailwindCss(): string {
  const lines: string[] = [HEADER, '@theme inline {'];
  for (const name of Object.keys(colors)) lines.push(`  --color-${name}: var(--${name});`);
  for (const name of Object.keys(aliases)) lines.push(`  --color-${name}: var(--${name});`);
  for (const step of Object.keys(scale.radius))
    lines.push(`  --radius-${step}: var(--radius-${step});`);
  lines.push(`  --shadow-1: var(--shadow-1);`);
  lines.push(`  --shadow-2: var(--shadow-2);`);
  lines.push(`  --font-sans: var(--font-family);`);
  for (const [name, px] of Object.entries(scale.breakpoint))
    lines.push(`  --breakpoint-${name}: ${px}px;`);
  // Shell and control sizes as spacing (`w-sidebar`, `h-topbar`, `h-control`) and the content
  // widths as containers (`max-w-form`, `max-w-detail`).
  lines.push('  --spacing-sidebar: var(--sidebar-width);');
  lines.push('  --spacing-sidebar-collapsed: var(--sidebar-collapsed);');
  lines.push('  --spacing-topbar: var(--topbar-height);');
  lines.push('  --spacing-control: var(--control-desktop);');
  lines.push('  --spacing-control-phone: var(--control-phone);');
  lines.push('  --spacing-row: var(--row-comfortable);');
  lines.push('  --spacing-row-compact: var(--row-compact);');
  lines.push('  --container-form: var(--content-form);');
  lines.push('  --container-detail: var(--content-detail);');
  lines.push('}', '');
  lines.push(':root {');
  const shadcn = SHADCN_ALIASES;
  for (const [alias, target] of Object.entries(shadcn))
    lines.push(`  --${alias}: var(--${target});`);
  lines.push('  --radius: var(--radius-lg);');
  lines.push('}', '');
  // Tailwind v4 makes utilities only from @theme keys, so the aliases need --color-* entries
  // too. `accent` stays the Shakti accent; hover fills use `highlight`.
  lines.push('@theme inline {');
  for (const alias of Object.keys(shadcn)) lines.push(`  --color-${alias}: var(--${alias});`);
  lines.push('}', '');
  return lines.join('\n');
}
