import { expect, type Page } from '@playwright/test';

/** Where a text box, a select or a button sits on the page, in CSS pixels. */
export interface Box {
  kind: 'control' | 'action';
  /** What the failure names: the element's accessible name, label or tag. */
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far apart two centres may be and still read as one line; anything more is visible. */
export const ALIGN_TOLERANCE_PX = 2;
/** The widest gap between a box and the button beside it that still makes them one row. */
export const ROW_GAP_PX = 24;
/** A taller element (a textarea, a card) is not a single-line control a button lines up with. */
const SAME_HEIGHT_PX = 12;

/**
 * Pairs of a control and a button beside it (on the same line, at most `ROW_GAP_PX` apart, of a
 * like height) whose vertical centres differ by more than `ALIGN_TOLERANCE_PX`: a button that
 * sits lower or higher than the box it acts on (docs/08-design-system.md §6). A button drawn
 * inside a box (a date picker's icon) overlaps it and is not a pair.
 */
export function misaligned(boxes: readonly Box[]): string[] {
  const controls = boxes.filter((b) => b.kind === 'control');
  const actions = boxes.filter((b) => b.kind === 'action');
  const found: string[] = [];
  for (const c of controls) {
    for (const a of actions) {
      const overlap = Math.min(c.y + c.height, a.y + a.height) - Math.max(c.y, a.y);
      if (overlap <= 0) continue;
      const gap = a.x >= c.x ? a.x - (c.x + c.width) : c.x - (a.x + a.width);
      if (gap < -1 || gap > ROW_GAP_PX) continue;
      if (Math.abs(c.height - a.height) > SAME_HEIGHT_PX) continue;
      const off = a.y + a.height / 2 - (c.y + c.height / 2);
      if (Math.abs(off) > ALIGN_TOLERANCE_PX) {
        found.push(
          `"${a.name}" is ${Math.abs(off).toFixed(1)} px ${off > 0 ? 'below' : 'above'} the centre of "${c.name}"`,
        );
      }
    }
  }
  return found;
}

/**
 * Fails the test when a button beside a text box or select is out of line with it, on the page
 * as it stands or inside `scope` (an open dialog). Called by `expectNoAxeViolations`, so every
 * screen a journey checks is checked in every project.
 */
export async function expectAligned(page: Page, scope?: string): Promise<void> {
  const boxes = await page.evaluate((root) => {
    const base: ParentNode =
      root === undefined ? document : (document.querySelector(root) ?? document);
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (el.closest('[aria-hidden="true"], [hidden], [inert]') !== null) return false;
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    };
    const nameOf = (el: Element): string => {
      const labelled = el.getAttribute('aria-label');
      if (labelled !== null && labelled !== '') return labelled;
      const id = el.getAttribute('id');
      if (id !== null) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label?.textContent) return label.textContent.trim();
      }
      const text = el.textContent.trim();
      return text !== '' ? text.slice(0, 60) : el.tagName.toLowerCase();
    };
    const out: {
      kind: 'control' | 'action';
      name: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[] = [];
    const controlSelector =
      'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]):not([type="range"]), select, [role="combobox"]';
    for (const el of base.querySelectorAll(controlSelector)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      out.push({
        kind: 'control',
        name: nameOf(el),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      });
    }
    for (const el of base.querySelectorAll('button, a[href]')) {
      if (!visible(el) || el.matches('[role="combobox"]')) continue;
      // A link counts only when drawn as a button (the Button component's `asChild`).
      if (el.tagName === 'A' && !getComputedStyle(el).display.includes('flex')) continue;
      const r = el.getBoundingClientRect();
      out.push({
        kind: 'action',
        name: nameOf(el),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      });
    }
    return out;
  }, scope);
  expect(misaligned(boxes), 'buttons out of line with the box beside them').toEqual([]);
}
