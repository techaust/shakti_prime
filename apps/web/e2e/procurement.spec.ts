import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  rowOf,
  showCompany,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { solidPng } from './support/png';
import { SNAPSHOT_COMPANY, SNAPSHOT_VENDORS } from './support/users';

// U1 vendors and supplier quotes (docs/03-roadmap-appendix/phase3.md §6.3). The vendor master is
// the group's, so each project adds a vendor of its own name and records its quote for company 1;
// the screenshots show only the seed's vendors (searched by their common word) and the snapshot
// company's quotes, where no journey records one. Dates move with the day the journeys run, so
// every date on these screens is a `time` element, which the screenshots mask.

/** A day from today in India as the date box takes it (DD-MM-YYYY). */
function dmy(daysFromToday: number): string {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000 + daysFromToday * 86400 * 1000);
  const iso = d.toISOString().slice(0, 10);
  const [y = '', m = '', day = ''] = iso.split('-');
  return `${day}-${m}-${y}`;
}

test.describe('as the Inventory Manager of company 1', () => {
  test.use(signedInAs('inventoryManager'));

  test('adds a vendor with a person and an item, records a quote and compares it', async ({
    page,
  }) => {
    const name = `Journey supplier ${projectName()} ${String(Date.now()).slice(-6)}`;
    await page.goto('/procurement/vendors');
    await expect(page.getByRole('heading', { name: 'Procurement', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Vendors' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('link', { name: 'Compare quotes' })).toBeVisible();

    const search = await hydrated(page.getByLabel('Find a vendor'));
    await search.fill(SNAPSHOT_VENDORS.search);
    const grid = dataGrid(page, 'Vendors');
    await expect(rowOf(grid, SNAPSHOT_VENDORS.cables)).toBeVisible();
    await expect(rowOf(grid, SNAPSHOT_VENDORS.solar)).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'procurement-vendors');

    await page.getByRole('button', { name: 'Add vendor' }).click();
    const form = page.getByRole('dialog', { name: 'Add a vendor' });
    await expect(form).toBeVisible();
    await expectNoAxeViolations(page);
    await form.getByLabel('Vendor name').fill(name);
    await form.getByLabel('Town or city').fill('Bikaner');
    await form.getByLabel('Payment terms in days').fill('30');
    await form.getByLabel('Delivery time in days').fill('5');
    await form.getByRole('button', { name: 'Save vendor' }).click();
    await expect(form).toBeHidden();

    // The new vendor's sheet opens by itself.
    const sheet = page.getByRole('dialog', { name });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('No people recorded for this vendor.')).toBeVisible();

    await sheet.getByRole('button', { name: 'Edit people' }).click();
    const people = page.getByRole('dialog', { name: `People at ${name}` });
    await people.getByRole('button', { name: 'Add person' }).click();
    await people.getByLabel('Name').fill('Order desk');
    await people.getByLabel('Mobile number').fill('98290 55555');
    await expectNoAxeViolations(page);
    await people.getByRole('button', { name: 'Save people' }).click();
    await expect(people).toBeHidden();
    await expect(sheet.getByText('Order desk')).toBeVisible();

    await sheet.getByRole('button', { name: 'Add item' }).click();
    const itemForm = page.getByRole('dialog', { name: `An item ${name} supplies` });
    await itemForm.getByLabel('Item', { exact: true }).fill('cable 4');
    await itemForm.getByRole('button', { name: 'Choose Solar cable 4 sq mm' }).click();
    await itemForm.getByLabel('Preferred vendor for this item').check();
    await expectNoAxeViolations(page);
    await itemForm.getByRole('button', { name: 'Save item' }).click();
    await expect(itemForm).toBeHidden();
    await expect(sheet.getByText('Solar cable 4 sq mm')).toBeVisible();

    await sheet.getByRole('button', { name: 'Record quote' }).click();
    const quote = page.getByRole('dialog', { name: `Record a quote from ${name}` });
    await expect(quote.getByLabel('Quoted to')).toHaveValue('1');
    await quote.getByLabel('Rate per unit before GST').fill('64.75');
    await quote.getByLabel('Minimum order').fill('250');
    await quote.getByLabel('Valid from').fill(dmy(0));
    await quote.getByLabel('Valid until').fill(dmy(30));
    await expectNoAxeViolations(page);
    await quote.getByRole('button', { name: 'Save quote' }).click();
    await expect(quote).toBeHidden();
    await expect(sheet.getByText('₹64.75 per Metre, before GST')).toBeVisible();
    await expect(sheet.getByText('Valid', { exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('link', { name: 'Compare quotes' }).click();
    await expect(page.getByRole('heading', { name: 'Compare quotes', level: 1 })).toBeVisible();
    await page.getByLabel('Category').selectOption('cable');
    const table = page
      .getByRole('region', { name: 'Quotes by item and vendor' })
      .or(page.getByRole('list', { name: 'Quotes by item and vendor' }))
      .filter({ visible: true });
    await expect(table.getByText(name)).toBeVisible();
    // Items down, vendors across: this run's vendor is a column, and earlier runs' vendors quoted
    // the same rate for the same item, so the rate shows once per run.
    await expect(table.getByText('₹64.75').first()).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('as the Inventory Manager of company 1, on the vendor the managers open', () => {
  test.use(signedInAs('inventoryManager'));

  test('sees the group\u2019s quote and company 1\u2019s on the same sheet (review M1)', async ({
    page,
  }) => {
    await page.goto('/procurement/vendors');
    const search = await hydrated(page.getByLabel('Find a vendor'));
    await search.fill(SNAPSHOT_VENDORS.search);
    await dataGrid(page, 'Vendors')
      .getByRole('button', { name: `Open ${SNAPSHOT_VENDORS.cables}` })
      .click();
    const sheet = page.getByRole('dialog', { name: SNAPSHOT_VENDORS.cables });
    await expect(sheet.getByRole('heading', { name: 'Quotes' })).toBeVisible();
    await expect(sheet.getByText('₹74.00 per Metre, before GST')).toBeVisible();
    await expect(sheet.getByText('₹71.00 per Metre, before GST')).toBeVisible();
    await expect(sheet.getByText(/For all companies/)).toBeVisible();
    await expect(sheet.getByText(/For Shakti Supreme/)).toBeVisible();
  });

  test('edits a vendor, records a quote with its document, withdraws it and archives the vendor (review L6)', async ({
    page,
  }) => {
    const name = `Journey dialogs ${projectName()} ${String(Date.now()).slice(-6)}`;
    await page.goto('/procurement/vendors');
    await (await hydrated(page.getByRole('button', { name: 'Add vendor' }))).click();
    const form = page.getByRole('dialog', { name: 'Add a vendor' });
    await form.getByLabel('Vendor name').fill(name);
    await form.getByRole('button', { name: 'Save vendor' }).click();
    const sheet = page.getByRole('dialog', { name });
    await expect(sheet).toBeVisible();

    await sheet.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog', { name: `Edit ${name}` });
    await expect(edit).toBeVisible();
    await expectNoAxeViolations(page);
    await edit.getByLabel('Delivery time in days').fill('9');
    await edit.getByRole('button', { name: 'Save vendor' }).click();
    await expect(edit).toBeHidden();
    await expect(sheet.getByText('9 days')).toBeVisible();

    await sheet.getByRole('button', { name: 'Record quote' }).click();
    const quote = page.getByRole('dialog', { name: `Record a quote from ${name}` });
    await quote.getByLabel('Item', { exact: true }).fill('cable 4');
    await quote.getByRole('button', { name: 'Choose Solar cable 4 sq mm' }).click();
    await quote.getByLabel('Rate per unit before GST').fill('66');
    await quote.getByLabel('Valid from').fill(dmy(0));
    await quote.getByLabel('Valid until').fill(dmy(20));
    await quote.locator('input[type="file"]').setInputFiles({
      name: 'Supplier quote.png',
      mimeType: 'image/png',
      buffer: solidPng(320, 200, [235, 240, 240]),
    });
    // The checks run in the app itself on this machine (no queue), then the uploader says so.
    await expect(quote.getByText('The quote document is ready.')).toBeVisible({ timeout: 45_000 });
    await expectNoAxeViolations(page);
    await quote.getByRole('button', { name: 'Save quote' }).click();
    await expect(quote).toBeHidden();
    await expect(
      sheet.getByRole('button', { name: /^Open the quote for Solar cable 4 sq mm/ }),
    ).toBeVisible();

    await sheet
      .getByRole('button', { name: /^Withdraw the quote for Solar cable 4 sq mm/ })
      .click();
    const withdraw = page.getByRole('dialog', {
      name: 'Withdraw the quote for Solar cable 4 sq mm?',
    });
    await expectNoAxeViolations(page);
    await withdraw.getByRole('button', { name: 'Withdraw quote' }).click();
    await expect(withdraw).toBeHidden();
    await expect(sheet.getByText('Withdrawn', { exact: true })).toBeVisible();

    await sheet.getByRole('button', { name: 'Archive', exact: true }).click();
    const archive = page.getByRole('dialog', { name: `Archive ${name}?` });
    await expectNoAxeViolations(page);
    await archive.getByRole('button', { name: 'Archive vendor' }).click();
    await expect(archive).toBeHidden();
    await expect(sheet.getByText('This vendor was archived.', { exact: false })).toBeVisible();
  });
});

test.describe('as an Executive acting for every company', () => {
  test.use(signedInAs('executive'));

  test('records a quote to the whole group that starts later, so no comparison shows it (review L6)', async ({
    page,
  }) => {
    const name = `Journey group ${projectName()} ${String(Date.now()).slice(-6)}`;
    await page.goto('/procurement/vendors');
    await showCompany(page, 'All companies');
    await (await hydrated(page.getByRole('button', { name: 'Add vendor' }))).click();
    const form = page.getByRole('dialog', { name: 'Add a vendor' });
    await form.getByLabel('Vendor name').fill(name);
    await form.getByRole('button', { name: 'Save vendor' }).click();
    const sheet = page.getByRole('dialog', { name });
    await sheet.getByRole('button', { name: 'Record quote' }).click();
    const quote = page.getByRole('dialog', { name: `Record a quote from ${name}` });
    await expect(quote.getByLabel('Quoted to')).toHaveValue('null');
    await quote.getByLabel('Item', { exact: true }).fill('cable 4');
    await quote.getByRole('button', { name: 'Choose Solar cable 4 sq mm' }).click();
    await quote.getByLabel('Rate per unit before GST').fill('68.5');
    await quote.getByLabel('Valid from').fill(dmy(30));
    await quote.getByLabel('Valid until').fill(dmy(60));
    await expectNoAxeViolations(page);
    await quote.getByRole('button', { name: 'Save quote' }).click();
    await expect(quote).toBeHidden();
    await expect(sheet.getByText('For all companies')).toBeVisible();
    await expect(sheet.getByText('Starts later', { exact: true })).toBeVisible();
  });
});

test.describe('as a General Manager or a Store Manager, who read no supplier rates', () => {
  for (const role of ['gm', 'storeManager'] as const) {
    test.describe(role, () => {
      test.use(signedInAs(role));

      test('sees the vendors and no rate anywhere, and cannot open the comparison', async ({
        page,
      }) => {
        await page.goto('/procurement/vendors');
        await expect(page.getByRole('heading', { name: 'Procurement', level: 1 })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Compare quotes' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Add vendor' })).toHaveCount(0);
        const search = await hydrated(page.getByLabel('Find a vendor'));
        await search.fill(SNAPSHOT_VENDORS.search);
        const grid = dataGrid(page, 'Vendors');
        await grid.getByRole('button', { name: `Open ${SNAPSHOT_VENDORS.cables}` }).click();
        const sheet = page.getByRole('dialog', { name: SNAPSHOT_VENDORS.cables });
        await expect(sheet.getByRole('heading', { name: 'Items supplied' })).toBeVisible();
        await expect(sheet.getByText('Solar cable 4 sq mm')).toBeVisible();
        await expect(sheet.getByRole('heading', { name: 'Quotes' })).toHaveCount(0);
        await expect(sheet.getByRole('button', { name: 'Record quote' })).toHaveCount(0);
        await expect(page.getByText('₹')).toHaveCount(0);
        await expectNoAxeViolations(page);
        if (role === 'gm') await snap(page, 'procurement-vendor-sheet-no-rates');

        // The not-found screen, as for any screen their grants do not open (review L6).
        await page.goto('/procurement/compare');
        await expect(
          page.getByRole('heading', { name: "We couldn't find this screen" }),
        ).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Compare quotes', level: 1 })).toHaveCount(
          0,
        );
      });
    });
  }
});

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('compares the snapshot company’s quotes: the lowest live rate marked, the expired one not', async ({
    page,
  }) => {
    await page.goto('/procurement/compare');
    await expect(page.getByRole('heading', { name: 'Compare quotes', level: 1 })).toBeVisible();
    await showCompany(page, 'All companies');
    const company = await hydrated(page.getByLabel('Company', { exact: true }));
    await company.selectOption(String(SNAPSHOT_COMPANY.entityId));
    const table = page
      .getByRole('region', { name: 'Quotes by item and vendor' })
      .or(page.getByRole('list', { name: 'Quotes by item and vendor' }))
      .filter({ visible: true });
    await expect(table.getByText('₹70.25')).toBeVisible();
    await expect(table.getByText('Expired')).toHaveCount(1);
    await expect(table.getByText('Lowest')).toHaveCount(2);
    await expectNoAxeViolations(page);
    await snap(page, 'procurement-compare');
  });
});
