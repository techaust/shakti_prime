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
import {
  PURCHASE_ORDER_IDS,
  PURCHASE_ORDER_JOURNEY,
  SNAPSHOT_VENDORS,
  STOCK_JOURNEY,
} from './support/users';

// U2 purchase orders and goods receipt (docs/03-roadmap-appendix/phase3.md §7.2). The Inventory
// Manager of company 1 drafts an order with its rate and sees its tax split, then receives the
// project's own sent order of two serial-tracked pumps by scanning their serials; the snapshot
// company's approved order is the order sheet's screenshot, with rates for its Executive and with
// none anywhere for its General Manager. Serials carry the project and the run's time, since a
// serial is unique for its item.

/** The run's two serials the pump's pattern (JP-0000) takes, new on each run and project. */
function serials(): [string, string] {
  const project = { 'desktop-light': 0, 'desktop-dark': 1, phone: 2 }[projectName()];
  const base = (Math.floor(Date.now() / 1000) % 3000) * 3 + project;
  const at = (n: number) => `JP-${String((base + n * 9000) % 10000).padStart(4, '0')}`;
  return [at(0), at(1)];
}

test.describe('as the Inventory Manager of company 1', () => {
  test.use(signedInAs('inventoryManager'));

  test('drafts a purchase order with its rate and sees the tax split', async ({ page }) => {
    await page.goto('/procurement/orders');
    await expect(page.getByRole('heading', { name: 'Purchase orders', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Purchase orders' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectNoAxeViolations(page);

    await page.getByRole('link', { name: 'New purchase order' }).click();
    await expect(page.getByRole('heading', { name: 'New purchase order', level: 1 })).toBeVisible();
    const vendor = await hydrated(page.getByLabel('Vendor'));
    await vendor.selectOption({ label: SNAPSHOT_VENDORS.cables });
    await page.getByLabel('Deliver to').selectOption({ label: STOCK_JOURNEY.hub.name });
    await page.getByLabel('Add an item').selectOption({ label: 'Solar cable 4 sq mm (JRN-CBL-4)' });
    await page.getByLabel('Quantity').fill('100');
    await page.getByLabel('Rate before GST').fill('72.50');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Save draft' }).click();

    await expect(page.getByRole('heading', { name: /^Purchase order / })).toBeVisible();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();
    // 100 m at ₹72.50 within Rajasthan at 18 %: ₹7,250 + ₹652.50 + ₹652.50.
    await expect(page.getByText('₹7,250.00').first()).toBeVisible();
    await expect(page.getByText('₹8,555.00')).toBeVisible();
    // A draft never prints: no Download PDF, and its PDF address answers not found.
    await expect(page.getByRole('link', { name: 'Download PDF' })).toHaveCount(0);
    const draftPdf = await page.request.get(`${new URL(page.url()).pathname}/pdf`);
    expect(draftPdf.status()).toBe(404);
    // Nobody approves an order they drafted, unless they are an Executive.
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(
      page.getByText('You drafted this purchase order, so someone else must approve it.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('receives the sent order of two pumps by scanning every serial', async ({ page }) => {
    const orderId = PURCHASE_ORDER_IDS.orders[projectName()];
    await page.goto(`/procurement/orders/${orderId}`);
    await expect(
      page.getByRole('heading', {
        name: `Purchase order ${PURCHASE_ORDER_JOURNEY.receiveNo[projectName()]}`,
      }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Receive goods' }).click();
    await expect(page.getByRole('heading', { name: /^Receive goods on / })).toBeVisible();

    const [first, second] = serials();
    const scan = await hydrated(page.getByLabel('Serial numbers'));
    await scan.fill('4006381333931');
    await scan.press('Enter');
    await expect(page.getByText('does not look like this item’s serials')).toBeVisible();
    await scan.fill(first);
    await scan.press('Enter');
    await expect(page.getByText('1 of 2 scanned')).toBeVisible();
    await scan.fill(first);
    await scan.press('Enter');
    await expect(page.getByText(`${first} is already in the list`)).toBeVisible();
    await expectNoAxeViolations(page);
    // One serial short: refused before anything is saved.
    await page.getByRole('button', { name: 'Save receipt' }).click();
    await expect(page.getByText('Scan a serial for every unit of Journey pump 5 HP')).toBeVisible();

    await scan.fill(second);
    await scan.press('Enter');
    await expect(page.getByText('2 of 2 scanned')).toBeVisible();
    await page.getByLabel('Vendor’s invoice number').fill('MC/2026/0042');
    await page.getByRole('button', { name: 'Save receipt' }).click();

    await expect(page.getByText('Received', { exact: true }).first()).toBeVisible();
    const receipts = dataGrid(page, 'Goods receipts');
    await expect(rowOf(receipts, 'MC/2026/0042')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('as the Executive of the snapshot company', () => {
  test.use(signedInAs('snapshotExecutive'));

  test('sees the order sheet with its rates and totals', async ({ page }) => {
    await page.goto(`/procurement/orders/${PURCHASE_ORDER_IDS.snapshotOrder}`);
    await expect(
      page.getByRole('heading', { name: `Purchase order ${PURCHASE_ORDER_JOURNEY.snapshotNo}` }),
    ).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Rate' })).toBeVisible();
    // 300 m at ₹70.25 within Rajasthan at 18 %: ₹21,075 + ₹1,896.75 + ₹1,896.75 = ₹24,868.50.
    await expect(page.getByText('₹24,869.00')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'purchase-order-sheet');
    const pdf = await page.request.get(
      `/procurement/orders/${PURCHASE_ORDER_IDS.snapshotOrder}/pdf`,
    );
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
  });
});

test.describe('as the General Manager of the snapshot company', () => {
  test.use(signedInAs('snapshotManager'));

  test('sees orders and the order sheet with no rate or amount anywhere', async ({ page }) => {
    await page.goto('/procurement/orders?state=approved');
    const grid = dataGrid(page, 'Approved purchase orders');
    await expect(rowOf(grid, PURCHASE_ORDER_JOURNEY.snapshotNo)).toBeVisible();
    await expect(page.getByRole('link', { name: 'New purchase order' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'purchase-orders-list');

    await rowOf(grid, PURCHASE_ORDER_JOURNEY.snapshotNo).getByRole('link').click();
    await expect(
      page.getByRole('heading', { name: `Purchase order ${PURCHASE_ORDER_JOURNEY.snapshotNo}` }),
    ).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Rate' })).toHaveCount(0);
    await expect(page.getByText('₹')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark sent' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'purchase-order-sheet-no-rates');

    await page.getByRole('link', { name: 'Goods received' }).click();
    await expect(page.getByRole('heading', { name: 'Goods received', level: 1 })).toBeVisible();
    await expect(page.getByText('₹')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});
