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
import { RESERVATION_JOURNEY, STOCK_JOURNEY, seededUsers } from './support/users';

// H2's reservations and availability (docs/03-roadmap-appendix/phase3.md §7.1, questions 3 (a)
// and 4 (a)). The seed gives each project an item of company 1 kept free in the stock journeys'
// first bin and three orders of it (`e2e/setup/reservations.ts`): the General Manager confirms
// one and sees its stock held; the Inventory Manager finds the hold of another on the item's stock
// card and extends it; the Lead Converter reads the third and sees each line's status, never a
// count. No quantity here is a client figure.

const LINES = 'Items on this order';
const HOLDS = 'Stock held for orders';
const NOT_FOUND = /^We couldn[’']t find this screen$/;

test.describe('as the General Manager, an order’s stock', () => {
  test.use(signedInAs('gm'));

  test('confirms the order, which sets its stock aside, and sees what each line holds', async ({
    page,
  }) => {
    const seed = seededUsers().reservations;
    const item = RESERVATION_JOURNEY.items[projectName()];
    await page.goto(
      `/orders/${String(RESERVATION_JOURNEY.entityId)}/${seed.confirmOrders[projectName()]}`,
    );
    const lines = dataGrid(page, LINES);
    // A draft reads the free stock, with its count for a reader of stock.
    await expect(rowOf(lines, item.name)).toContainText('In stock');
    await expect(rowOf(lines, item.name)).toContainText(/\d+ free/);
    await expect(page.getByRole('heading', { name: HOLDS })).toHaveCount(0);
    await expectNoAxeViolations(page);

    await (await hydrated(page.getByRole('button', { name: 'Confirm the order' }))).click();
    await expect(page.getByText('Order confirmed.')).toBeVisible();
    await expect(page.getByRole('heading', { name: HOLDS })).toBeVisible();
    const holds = dataGrid(page, HOLDS);
    await expect(rowOf(holds, item.name)).toContainText(
      `${STOCK_JOURNEY.hub.name} · ${STOCK_JOURNEY.bins[0]}`,
    );
    await expect(rowOf(holds, item.name)).toContainText(String(RESERVATION_JOURNEY.orderQty));
    await expect(rowOf(lines, item.name)).toContainText(
      `${String(RESERVATION_JOURNEY.orderQty)} held`,
    );
    await expectNoAxeViolations(page);
    await snap(page, 'reservations-order-holds', {
      element: page.locator('section[aria-labelledby="reservations-heading"]'),
    });
  });
});

test.describe('as the Inventory Manager, an item’s holds', () => {
  test.use(signedInAs('inventoryManager'));

  test('finds the hold on the stock card and extends it once', async ({ page }) => {
    const seed = seededUsers().reservations;
    const item = RESERVATION_JOURNEY.items[projectName()];
    const { soNo } = seed.heldOrders[projectName()];
    await page.goto(
      `/inventory/stock/${String(RESERVATION_JOURNEY.entityId)}/${seed.items[projectName()]}`,
    );
    await expect(page.getByRole('heading', { name: item.name, level: 1 })).toBeVisible();
    const holds = dataGrid(page, HOLDS);
    const row = rowOf(holds, soNo);
    await expect(row).toContainText(`${STOCK_JOURNEY.hub.name} · ${STOCK_JOURNEY.bins[0]}`);
    await expect(page.getByRole('heading', { name: 'Orders waiting for this item' })).toBeVisible();
    await expectNoAxeViolations(page);

    await (
      await hydrated(row.getByRole('button', { name: `Extend the hold on ${item.name}` }))
    ).click();
    const dialog = page.getByRole('dialog', { name: 'Extend this hold' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Reason').fill('Site not ready, the customer asked to wait');
    await expectNoAxeViolations(page);
    await snap(page, 'reservations-extend-dialog', { element: dialog });
    await dialog.getByRole('button', { name: 'Extend hold' }).click();
    await expect(page.getByText('Hold extended.')).toBeVisible();
    await expect(row).toContainText('Extended once');
    // A hold is extended only once.
    await expect(row.getByRole('button', { name: `Extend the hold on ${item.name}` })).toHaveCount(
      0,
    );
  });
});

test.describe('as a Lead Converter, an order’s availability', () => {
  test.use(signedInAs('converter'));

  test('shows each line’s status and never a count, and the stock screens stay closed', async ({
    page,
  }) => {
    const seed = seededUsers().reservations;
    const item = RESERVATION_JOURNEY.items[projectName()];
    await page.goto(
      `/orders/${String(RESERVATION_JOURNEY.entityId)}/${seed.viewOrders[projectName()]}`,
    );
    const lines = dataGrid(page, LINES);
    await expect(rowOf(lines, item.name)).toContainText('In stock');
    await expect(rowOf(lines, item.name)).not.toContainText(/free|held|waiting|dispatched/);
    await expect(page.getByRole('heading', { name: HOLDS })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'reservations-converter-lines', { element: lines });

    // The Lead Converter holds no inventory.stock.read (the owner, 27-11-2026).
    await page.goto('/inventory/stock');
    await expect(page.getByRole('heading', { name: NOT_FOUND })).toBeVisible();
  });
});
