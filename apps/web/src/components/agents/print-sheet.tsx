import { aliases, colors, shadows } from '@shakti/tokens';
import type { ReactNode } from 'react';

// A screen that prints as a document (docs/08-design-system.md §1, "printed outputs are always
// light"): in print, only the sheet shows, in the light theme whatever theme the screen is in, on
// A4 with 15 mm margins. Built from the tokens themselves, so the print matches `.theme-light`.

const light = [
  ...Object.entries(colors).map(([name, value]) => `--${name}: ${value.light};`),
  ...Object.entries(shadows).map(([name, value]) => `--${name}: ${value.light};`),
  // A var() resolves where it is declared, so the aliases are declared again on the sheet.
  ...Object.entries(aliases).map(([name, target]) => `--${name}: var(--${target});`),
  'color-scheme: light;',
].join(' ');

const PRINT_CSS = `@media print {
  @page { size: A4; margin: 15mm; }
  html body { background: ${colors.bg.light}; }
  body * { visibility: hidden; }
  .print-sheet, .print-sheet * { visibility: visible; }
  .print-sheet { ${light} position: absolute; top: 0; left: 0; width: 100%; background: var(--bg); color: var(--text); }
}`;

/** The sheet: on screen it is the page as it stands; in print it is all there is, light. */
export function PrintSheet({ children }: { children: ReactNode }) {
  return (
    <div className="print-sheet">
      <style>{PRINT_CSS}</style>
      {children}
    </div>
  );
}
