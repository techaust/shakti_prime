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
import { SNAPSHOT_COMPANY, STOCK_JOURNEY } from './support/users';

// H1's stock screens (docs/03-roadmap-appendix/phase3.md §6.2). The seed gives each project an
// item of company 1 with stock in the journeys' godown (`e2e/setup/stock.ts`), which the Inventory
// Manager adjusts, moves between bins and reverses from its stock card; and the snapshot company
// a godown of its own with two items' stock at fixed test costs, dated to the snapshot's own day,
// which the Executive values and the screenshots show. No quantity or cost here is a client
// figure. Each run's notes carry a word of their own, so a row is found by its note on a database
// earlier runs used.

const NOT_FOUND = /^We couldn[’']t find this screen$/;

test.describe('as the Inventory Manager, an item’s stock card', () => {
  test.use(signedInAs('inventoryManager'));

  test('finds the item, adjusts its stock, moves it between bins and reverses the move', async ({
    page,
  }) => {
    const item = STOCK_JOURNEY.items[projectName()];
    const [fromBin, toBin] = STOCK_JOURNEY.bins;
    const run = `R${String(Date.now()).slice(-8)}`;
    await page.goto('/inventory/stock');
    await expect(page.getByRole('heading', { name: 'Stock', level: 1 })).toBeVisible();
    await (await hydrated(page.getByLabel('Item'))).fill(item.sku);
    await page.getByRole('button', { name: 'Show stock' }).click();
    const list = dataGrid(page, 'Stock by hub, bin and item');
    await expect(rowOf(list, item.sku).first()).toBeVisible();
    await expectNoAxeViolations(page);

    await rowOf(list, item.sku).first().getByRole('link', { name: item.name }).click();
    await expect(page.getByRole('heading', { name: item.name, level: 1 })).toBeVisible();
    await expect(dataGrid(page, 'Stock of this item in each hub')).toContainText(
      STOCK_JOURNEY.hub.name,
    );
    await expectNoAxeViolations(page);

    // A gain of 5 metres in the first bin, with why.
    await (await hydrated(page.getByRole('button', { name: 'Adjust stock' }))).click();
    const adjust = page.getByRole('dialog', { name: `Adjust stock of ${item.name}` });
    await expect(adjust).toBeVisible();
    await adjust.getByLabel('Hub').selectOption({ label: STOCK_JOURNEY.hub.name });
    await adjust.getByLabel('Bin', { exact: true }).selectOption({ label: `${fromBin} (Storage)` });
    await snap(page, 'stock-adjust-dialog', { element: adjust });
    await adjust.getByLabel('Change').selectOption({ label: 'Found (add stock)' });
    await adjust.getByLabel('Quantity').fill('5');
    const gainNote = `Found behind the rack, walk ${run}`;
    await adjust.getByLabel('Reason').fill(gainNote);
    await expectNoAxeViolations(page);
    await adjust.getByRole('button', { name: 'Save adjustment' }).click();
    await expect(page.getByText('Stock adjusted.')).toBeVisible();
    const movements = dataGrid(page, 'Stock movements, newest first');
    await expect(rowOf(movements, gainNote)).toContainText('Found (gain)');

    // Two metres from the first bin to the second: the newest movement of this project's item.
    await page.getByRole('button', { name: 'Move between bins' }).click();
    const move = page.getByRole('dialog', { name: `Move ${item.name} between bins` });
    await move.getByLabel('Hub').selectOption({ label: STOCK_JOURNEY.hub.name });
    await move.getByLabel('From bin').selectOption({ label: `${fromBin} (Storage)` });
    await move.getByLabel('To bin').selectOption({ label: `${toBin} (Storage)` });
    await snap(page, 'stock-move-dialog', { element: move });
    await move.getByLabel('Quantity').fill('2');
    await expectNoAxeViolations(page);
    await move.getByRole('button', { name: 'Move stock' }).click();
    await expect(page.getByText('Stock moved.')).toBeVisible();
    // A move carries no note: it is the newest movement of an item that is this project's alone,
    // the first body row of the table or the first card of a phone's list.
    const moved = movements.locator('tbody tr').or(movements.getByRole('listitem')).first();
    await expect(moved).toContainText('Moved between bins');
    await expect(moved).toContainText(`${toBin} in ${STOCK_JOURNEY.hub.code}`);

    // Made in error: reversed from its row, with a note of this run.
    await moved.getByRole('button', { name: 'Reverse' }).click();
    const reverse = page.getByRole('dialog', { name: 'Reverse this movement' });
    await snap(page, 'stock-reverse-dialog', { element: reverse });
    const reverseNote = `Moved to the wrong bin, walk ${run}`;
    await reverse.getByLabel('Reason (optional)').fill(reverseNote);
    await expectNoAxeViolations(page);
    await reverse.getByRole('button', { name: 'Reverse movement' }).click();
    await expect(page.getByText('Movement reversed.')).toBeVisible();
    await expect(rowOf(movements, reverseNote)).toContainText('Reversed');
    await expect(moved).toContainText('Undone by a reversal');
  });

  test('cannot open the stock valuation, and the menu does not offer it', async ({ page }) => {
    await page.goto('/inventory/valuation');
    await expect(page.getByRole('heading', { name: NOT_FOUND })).toBeVisible();
    await page.goto('/inventory/stock');
    await expect(page.getByRole('heading', { name: 'Stock', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stock valuation' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Hubs and bins' }).first()).toBeAttached();
  });

  test('reads the hubs and bins with no form to change them', async ({ page }) => {
    await page.goto('/inventory/hubs');
    await expect(page.getByRole('heading', { name: 'Hubs and bins', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('region', {
        name: `${STOCK_JOURNEY.hub.name} (${STOCK_JOURNEY.hub.code})`,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add hub' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Edit|Add bin to|Archive) / })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});

test.describe('as an Executive, the stock screens', () => {
  test.use(signedInAs('executive'));

  test('values the snapshot company’s stock per hub and category on the snapshot’s day', async ({
    page,
  }) => {
    await page.goto(
      `/inventory/valuation?company=${String(SNAPSHOT_COMPANY.entityId)}&date=${STOCK_JOURNEY.snapshot.date}`,
    );
    await expect(page.getByRole('heading', { name: 'Stock valuation', level: 1 })).toBeVisible();
    const table = dataGrid(page, 'Stock value by hub and category');
    // 120 at ₹85.50 and 300 at ₹42.00.
    await expect(rowOf(table, 'Pipe')).toContainText('₹10,260.00');
    await expect(rowOf(table, 'Cable')).toContainText('₹12,600.00');
    await expect(page.getByText('Total value: ₹22,860.00')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'stock-valuation');
  });

  test('shows the snapshot company’s stock, an item’s stock card and the hubs', async ({
    page,
  }) => {
    await page.goto(`/inventory/stock?company=${String(SNAPSHOT_COMPANY.entityId)}&q=SNP-STK`);
    const list = dataGrid(page, 'Stock by hub, bin and item');
    for (const item of STOCK_JOURNEY.snapshot.items) {
      await expect(rowOf(list, item.sku)).toBeVisible();
    }
    await expectNoAxeViolations(page);
    await snap(page, 'stock-list');

    // The card: its one movement is older than the reversal window, so it offers no Reverse.
    const [first] = STOCK_JOURNEY.snapshot.items;
    await rowOf(list, first.sku).getByRole('link', { name: first.name }).click();
    await expect(page.getByRole('heading', { name: first.name, level: 1 })).toBeVisible();
    await expect(dataGrid(page, 'Stock movements, newest first')).toContainText('Snapshot stock');
    await expectNoAxeViolations(page);
    await snap(page, 'stock-card');

    await page.goto('/inventory/hubs');
    await expect(page.getByRole('heading', { name: 'Hubs and bins', level: 1 })).toBeVisible();
    const hub = page.getByRole('region', {
      name: `${STOCK_JOURNEY.snapshot.hub.name} (${STOCK_JOURNEY.snapshot.hub.code})`,
    });
    const bins = `Bins of ${STOCK_JOURNEY.snapshot.hub.name}`;
    await expect(
      hub
        .getByRole('table', { name: bins })
        .or(hub.getByRole('list', { name: bins }))
        .filter({ visible: true }),
    ).toContainText(STOCK_JOURNEY.snapshot.bin);
    await expect(page.getByRole('button', { name: 'Add hub' })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'stock-hubs');
  });
});
