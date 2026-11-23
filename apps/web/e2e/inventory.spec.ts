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
// a godown of its own with two items' stock at fixed test costs, which the Executive values and
// the screenshots show. No quantity or cost here is a client figure.

test.describe('as the Inventory Manager, an item’s stock card', () => {
  test.use(signedInAs('inventoryManager'));

  test('finds the item, adjusts its stock, moves it between bins and reverses the move', async ({
    page,
  }) => {
    const item = STOCK_JOURNEY.items[projectName()];
    const [fromBin, toBin] = STOCK_JOURNEY.bins;
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
    await adjust.getByLabel('Change').selectOption({ label: 'Found (add stock)' });
    await adjust.getByLabel('Hub').selectOption({ label: STOCK_JOURNEY.hub.name });
    await adjust.getByLabel('Bin', { exact: true }).selectOption({ label: `${fromBin} (Storage)` });
    await adjust.getByLabel('Quantity').fill('5');
    await adjust.getByLabel('Reason').fill('Found behind the rack during the weekly walk');
    await expectNoAxeViolations(page);
    await adjust.getByRole('button', { name: 'Save adjustment' }).click();
    await expect(page.getByText('Stock adjusted.')).toBeVisible();
    const movements = dataGrid(page, 'Stock movements, newest first');
    await expect(rowOf(movements, 'Found (gain)').first()).toContainText(
      'Found behind the rack during the weekly walk',
    );

    // Two metres from the first bin to the second.
    await page.getByRole('button', { name: 'Move between bins' }).click();
    const move = page.getByRole('dialog', { name: `Move ${item.name} between bins` });
    await move.getByLabel('Hub').selectOption({ label: STOCK_JOURNEY.hub.name });
    await move.getByLabel('From bin').selectOption({ label: `${fromBin} (Storage)` });
    await move.getByLabel('To bin').selectOption({ label: `${toBin} (Storage)` });
    await move.getByLabel('Quantity').fill('2');
    await expectNoAxeViolations(page);
    await move.getByRole('button', { name: 'Move stock' }).click();
    await expect(page.getByText('Stock moved.')).toBeVisible();
    const moved = rowOf(movements, 'Moved between bins').first();
    await expect(moved).toContainText(`${toBin} in ${STOCK_JOURNEY.hub.code}`);

    // Made in error: reversed from its row.
    await moved.getByRole('button', { name: 'Reverse' }).click();
    const reverse = page.getByRole('dialog', { name: 'Reverse this movement' });
    await reverse.getByLabel('Reason (optional)').fill('Moved to the wrong bin');
    await expectNoAxeViolations(page);
    await reverse.getByRole('button', { name: 'Reverse movement' }).click();
    await expect(page.getByText('Movement reversed.')).toBeVisible();
    await expect(rowOf(movements, 'Reversed').first()).toBeVisible();
  });

  test('cannot open the stock valuation', async ({ page }) => {
    await page.goto('/inventory/valuation');
    await expect(page.getByRole('heading', { name: 'Stock valuation' })).toHaveCount(0);
  });
});

test.describe('as an Executive, the stock screens', () => {
  test.use(signedInAs('executive'));

  test('values the snapshot company’s stock per hub and category', async ({ page }) => {
    await page.goto(`/inventory/valuation?company=${String(SNAPSHOT_COMPANY.entityId)}`);
    await expect(page.getByRole('heading', { name: 'Stock valuation', level: 1 })).toBeVisible();
    const table = dataGrid(page, 'Stock value by hub and category');
    // 120 at ₹85.50 and 300 at ₹42.00.
    await expect(rowOf(table, 'Pipe')).toContainText('₹10,260.00');
    await expect(rowOf(table, 'Cable')).toContainText('₹12,600.00');
    await expect(page.getByText('Total value: ₹22,860.00')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'stock-valuation');
  });

  test('shows the snapshot company’s stock and the hubs with their bins', async ({ page }) => {
    await page.goto(`/inventory/stock?company=${String(SNAPSHOT_COMPANY.entityId)}&q=SNP-STK`);
    const list = dataGrid(page, 'Stock by hub, bin and item');
    for (const item of STOCK_JOURNEY.snapshot.items) {
      await expect(rowOf(list, item.sku)).toBeVisible();
    }
    await expectNoAxeViolations(page);
    await snap(page, 'stock-list');

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
