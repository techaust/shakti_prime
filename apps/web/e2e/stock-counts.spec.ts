import type { Page } from '@playwright/test';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  rowOf,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { STOCK_COUNT_JOURNEY } from './support/users';

// H3's stock count screens (docs/03-roadmap-appendix/phase3.md §7.3). The seed gives each project
// a godown of company 1 with a cable (40 metres in CA-01, 10 in CA-02) and a pump with three
// serials in CA-01, put back to that stock each run, and cancels any count a run before left live
// (`e2e/setup/stock-counts.ts`). The counter counts blind: no expected quantity, difference or
// number of serials appears on the counting screen at any step. The Inventory Manager then reviews
// the differences, asks for one item again, and posts. Only the Executive, the Inventory Manager
// and the Field Engineer (`own`) hold `inventory.stock.move` today, so the count is counted by the
// Inventory Manager on the counting screen; the Store Manager reads the counts and cannot count.

const NOT_FOUND = /^We couldn[’']t find this screen$/;

/** This project's godown, items and serials. */
const journey = () => STOCK_COUNT_JOURNEY.projects[projectName()];

/** No number the records hold for these shelves, and no word for a difference, on the page. */
async function expectBlind(page: Page): Promise<void> {
  const main = page.getByRole('main');
  await expect(main).not.toContainText(/\b(40|10)\b/);
  await expect(main).not.toContainText(/difference|expected|records hold|short|extra/i);
}

/** The item's row in a bin of the counting screen. */
function itemIn(page: Page, bin: string, name: string) {
  return page
    .getByRole('list', { name: `Items in bin ${bin}` })
    .getByRole('listitem')
    .filter({
      hasText: name,
    });
}

test.describe('a stock count', () => {
  test.describe.configure({ mode: 'serial' });
  test.use(signedInAs('inventoryManager'));

  test('is started for a hub and counted blind, item by item and serial by serial', async ({
    page,
  }) => {
    const { hub, cable, pump, serials } = journey();
    const [first, second] = STOCK_COUNT_JOURNEY.bins;
    await page.goto('/inventory/counts');
    await expect(page.getByRole('heading', { name: 'Stock counts', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    await (await hydrated(page.getByRole('button', { name: 'Start a count' }))).click();
    const start = page.getByRole('dialog', { name: 'Start a stock count' });
    await start.getByLabel('Hub', { exact: true }).selectOption({ label: hub.name });
    await expect(start.getByLabel('The whole hub')).toBeChecked();
    await expectNoAxeViolations(page);
    await start.getByRole('button', { name: 'Start count' }).click();
    await expect(page.getByText('Count started.')).toBeVisible();

    // The counting screen: the bins and items, nothing of what the records hold.
    await expect(page.getByRole('heading', { name: `Count ${hub.name}`, level: 1 })).toBeVisible();
    await expect(page.getByText('3 items still to count.')).toBeVisible();
    await expectBlind(page);
    await snap(page, 'count-to-count');
    await expectNoAxeViolations(page);

    // The cable in the first bin: 38 metres on the shelf.
    await (
      await hydrated(
        itemIn(page, first, cable.name).getByRole('button', { name: `Count ${cable.name}` }),
      )
    ).click();
    await itemIn(page, first, cable.name).getByLabel('Quantity counted').fill('38');
    await expectNoAxeViolations(page);
    await itemIn(page, first, cable.name).getByRole('button', { name: 'Save count' }).click();
    await expect(page.getByText('Count saved.')).toBeVisible();
    await expect(itemIn(page, first, cable.name)).toContainText('You entered 38 metres');

    // The cable in the second bin, as many as the shelf holds.
    await itemIn(page, second, cable.name)
      .getByRole('button', { name: `Count ${cable.name}` })
      .click();
    await itemIn(page, second, cable.name).getByLabel('Quantity counted').fill('9');
    await itemIn(page, second, cable.name).getByRole('button', { name: 'Save count' }).click();
    await expect(itemIn(page, second, cable.name)).toContainText('You entered 9 metres');

    // The pump: two serials scanned, the second scanned twice, and one of the wrong item.
    const pumpRow = itemIn(page, first, pump.name);
    await pumpRow.getByRole('button', { name: `Count ${pump.name}` }).click();
    const serial = pumpRow.getByLabel('Serial number', { exact: true });
    await serial.fill(serials[0]);
    await serial.press('Enter');
    await serial.fill(serials[1]);
    await serial.press('Enter');
    await serial.fill(serials[1]);
    await serial.press('Enter');
    await expect(pumpRow.getByText('You have already added this serial number.')).toBeVisible();
    await expect(
      pumpRow.getByRole('list', { name: 'Serial numbers found' }).getByRole('listitem'),
    ).toHaveCount(2);
    await expectBlind(page);
    await snap(page, 'count-serials', { element: pumpRow });
    await expectNoAxeViolations(page);
    await pumpRow.getByRole('button', { name: 'Save count' }).click();
    await expect(pumpRow).toContainText('You found 2 serial numbers');

    await expect(page.getByText('Every item is counted.')).toBeVisible();
    await expectBlind(page);
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByText('Sent for review.')).toBeVisible();
    await expect(page.getByText(/This count is not open for counting\. In review\./)).toBeVisible();
  });

  test('is reviewed, one item counted again, and posted', async ({ page }) => {
    const { hub, cable, pump, serials } = journey();
    const [first] = STOCK_COUNT_JOURNEY.bins;
    await page.goto('/inventory/counts?state=review');
    const list = dataGrid(page, 'Stock counts, newest first');
    const row = rowOf(list, hub.name).first();
    await expect(row).toContainText('In review');
    await row.getByRole('link', { name: `Review: Open the count of ${hub.name}` }).click();

    await expect(
      page.getByRole('heading', { name: `Review the count of ${hub.name}`, level: 1 }),
    ).toBeVisible();
    const lines = dataGrid(page, 'What was counted, against the records');
    // 38 against 40 in the first bin; 9 against 10 in the second; the third serial missing.
    await expect(rowOf(lines, cable.name).filter({ hasText: first }).first()).toContainText('-2');
    await expect(rowOf(lines, serials[2])).toContainText('-1');
    // The Inventory Manager holds no finance.cost.read: no value anywhere.
    await expect(page.getByText(/Net value/)).toHaveCount(0);
    await expect(
      page.getByText('No stock moved in the counted bins during the count.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'count-review', { element: lines });

    // The first bin's cable again: back to counting, then counted at 39 on the counting screen.
    await (
      await hydrated(
        page.getByRole('button', { name: `Count again: ${cable.name} in bin ${first}` }),
      )
    ).click();
    await expect(page.getByText('Asked for that item to be counted again.')).toBeVisible();
    await page.getByRole('link', { name: 'Open the counting screen' }).click();
    const cableRow = itemIn(page, first, cable.name);
    await expect(cableRow).toContainText('Count again');
    // The recount shows nothing of the first count.
    await expect(cableRow).not.toContainText('38');
    await expectBlind(page);
    await cableRow.getByRole('button', { name: `Count ${cable.name}` }).click();
    await cableRow.getByLabel('Quantity counted').fill('39');
    await cableRow.getByRole('button', { name: 'Save count' }).click();
    await expect(cableRow).toContainText('You entered 39 metres');
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByText('Sent for review.')).toBeVisible();

    await page.getByRole('link', { name: 'Review this count' }).click();
    await expect(rowOf(lines, cable.name).filter({ hasText: first }).first()).toContainText(
      'First count 38',
    );
    const post = page.getByRole('region', { name: 'Post this count' });
    await post.getByLabel('Note for the records').fill('Month-end count of the journey godown');
    await post.getByLabel(`Why ${serials[2]} is missing (optional)`).fill('Not on the rack');
    await expectNoAxeViolations(page);
    await post.getByRole('button', { name: 'Post count' }).click();
    await expect(
      page.getByText('Count posted. The stock now matches what was counted.'),
    ).toBeVisible();
    await expect(page.getByText('Posted', { exact: true }).first()).toBeVisible();

    // The sheet for the record, printed from the review.
    await page.goto(page.url().replace('/review', '/sheet'));
    await expect(page.getByRole('heading', { name: 'Stock count sheet', level: 1 })).toBeVisible();
    await expect(
      page.frameLocator('iframe[title="Stock count sheet"]').getByText(pump.name).first(),
    ).toBeVisible();
    // The printed sheet is a document of its own, always light; axe checks the page around it.
    await expectNoAxeViolations(page, { removeFrames: 'iframe[title="Stock count sheet"]' });
  });
});

test.describe('as the Store Manager, stock counts', () => {
  test.use(signedInAs('storeManager'));

  test('are listed to read, with no way to start or count one', async ({ page }) => {
    await page.goto('/inventory/counts');
    await expect(page.getByRole('heading', { name: 'Stock counts', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start a count' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Count: / })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Review: / })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.goto('/inventory/counts/01990000-0000-7000-8000-000000000001');
    await expect(page.getByRole('heading', { name: NOT_FOUND })).toBeVisible();
  });
});
