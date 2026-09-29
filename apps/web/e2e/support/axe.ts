import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.1 levels A and AA, the bar DESIGN.md §9 sets for every screen. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Parts of a page axe does not judge, each with its reason. The bot-check widget is Cloudflare's
 * own frame on another origin: its markup is not ours to change, and the form around it carries
 * the labels and the error text.
 */
const ALWAYS_EXCLUDED = ['iframe[src*="challenges.cloudflare.com"]'];

export interface AxeOptions {
  /** Further CSS selectors to leave out; each call site says why in a comment. */
  exclude?: string[];
  /**
   * Frames taken off the page before axe runs, because axe cannot run inside them: a sandboxed
   * frame with no scripts never answers axe's frame handshake, and the run waits until the test
   * times out. Each call site says why in a comment; take the page's screenshot first.
   */
  removeFrames?: string;
  /**
   * Checks only this part of the page. For an open modal menu or dialog: Radix hides the rest of
   * the page from assistive technology and keeps focus inside, so the rest is checked closed.
   */
  include?: string;
}

/** Fails the test with every WCAG 2.1 A or AA violation axe finds on the page as it stands. */
export async function expectNoAxeViolations(page: Page, options: AxeOptions = {}): Promise<void> {
  if (options.removeFrames !== undefined) {
    await page.locator(options.removeFrames).evaluateAll((frames) => {
      for (const frame of frames) frame.remove();
    });
  }
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (options.include !== undefined) builder = builder.include(options.include);
  for (const selector of [...ALWAYS_EXCLUDED, ...(options.exclude ?? [])]) {
    builder = builder.exclude(selector);
  }
  const { violations } = await builder.analyze();
  const summary = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`),
  }));
  expect(summary, 'accessibility violations (WCAG 2.1 A and AA)').toEqual([]);
}
