// Generates the CSS delivered to the web app (DESIGN.md §8). Pure functions so the
// stale-file test can compare the committed output with a fresh render.
import { aliases, colors, scale, shadows, type Theme } from './tokens';

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

function staticBlock(indent: string): string {
  const lines: string[] = [];
  for (const [name, target] of Object.entries(aliases))
    lines.push(`${indent}--${name}: var(--${target});`);
  for (const [step, px] of Object.entries(scale.space))
    lines.push(`${indent}--space-${step}: ${px}px;`);
  for (const [step, px] of Object.entries(scale.radius))
    lines.push(`${indent}--radius-${step}: ${px}px;`);
  for (const [role, font] of Object.entries(scale.font)) {
    lines.push(`${indent}--font-${role}-size: ${font.size}px;`);
    lines.push(`${indent}--font-${role}-line: ${font.line}px;`);
    lines.push(`${indent}--font-${role}-weight: ${font.weight};`);
  }
  lines.push(`${indent}--font-family: ${scale.fontFamily};`);
  for (const [name, ms] of Object.entries(scale.motion))
    lines.push(`${indent}--motion-${name}: ${ms}ms;`);
  lines.push(`${indent}--row-comfortable: ${scale.row.comfortable}px;`);
  lines.push(`${indent}--row-compact: ${scale.row.compact}px;`);
  lines.push(`${indent}--control-desktop: ${scale.control.desktop}px;`);
  lines.push(`${indent}--control-phone: ${scale.control.phone}px;`);
  lines.push(`${indent}--focus-ring-width: ${scale.focusRing.width}px;`);
  lines.push(`${indent}--focus-ring-offset: ${scale.focusRing.offset}px;`);
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
  ].join('\n');
}

/**
 * `tailwind.css`: Tailwind v4 theme mapping and shadcn/ui aliases. shadcn's own `--accent`
 * (a hover surface) is not aliased because the Shakti accent token already owns that name.
 */
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
  lines.push('}', '');
  lines.push(':root {');
  const shadcn: Record<string, string> = {
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
    destructive: 'danger',
    'destructive-foreground': 'danger-soft',
    input: 'border-strong',
    ring: 'focus',
  };
  for (const [alias, target] of Object.entries(shadcn))
    lines.push(`  --${alias}: var(--${target});`);
  lines.push('  --radius: var(--radius-lg);');
  lines.push('}', '');
  return lines.join('\n');
}
