import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { checkDocument, parseBudgets } from '../../scripts/js-budget';

const budgets = parseBudgets(
  JSON.parse(readFileSync(new URL('../../js-budget.json', import.meta.url), 'utf8')) as unknown,
);

/**
 * A first visit's HTML, the server's payload for the page and its messages inline, against its
 * document budget in js-budget.json (WEB-1), as the browsing context's cookies fetch it.
 */
export async function expectDocumentWithinBudget(page: Page, route: string): Promise<void> {
  const response = await page.request.get(route);
  expect(response.ok()).toBe(true);
  expect(checkDocument(route, await response.body(), budgets)).toBeUndefined();
}
