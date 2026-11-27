import type { Page } from '@playwright/test';
import jsQR from 'jsqr';
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
import { loadCatalogueAsModule } from './support/quote-pdf';
import { LABEL_JOURNEY, STOCK_JOURNEY } from './support/users';

// Q1's labels (docs/03-roadmap-appendix/phase3.md §7.4). The Inventory Manager of company 1 prints
// the journey godown's bin labels and prints one serial's label again with why; each sheet is
// printed by the render worker in the app (no queue on this machine) and opened as a PDF. The
// label pages themselves are covered by `print.spec.ts`. Below, the labels as Chromium prints them:
// every kind's QR code read back with jsQR, and a sheet of 500 timed against the render route's
// budget.

/** The sheet's PDF, fetched from the signed address the new tab is sent to. */
async function expectSheetOpens(page: Page, open: () => Promise<void>): Promise<void> {
  const signed = page
    .context()
    .waitForEvent('request', (r) => r.url().includes('/api/v1/files/local/'));
  const opened = page.waitForEvent('popup');
  await open();
  const tab = await opened;
  const pdf = await page.request.get((await signed).url());
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await tab.close();
}

test.describe('as the Inventory Manager, labels', () => {
  test.use(signedInAs('inventoryManager'));

  test('prints the bin labels of a hub', async ({ page }) => {
    await page.goto('/inventory/hubs');
    await expect(page.getByRole('heading', { name: 'Hubs and bins', level: 1 })).toBeVisible();
    const hub = page.getByRole('region', {
      name: `${STOCK_JOURNEY.hub.name} (${STOCK_JOURNEY.hub.code})`,
    });
    await expect(hub).toBeVisible();
    // A stock handler prints labels; the hubs themselves stay the Executive's to change.
    await expect(page.getByRole('button', { name: 'Add hub' })).toHaveCount(0);
    await expectNoAxeViolations(page);

    const print = await hydrated(
      hub.getByRole('button', { name: `Print labels for ${STOCK_JOURNEY.hub.name}` }),
    );
    await print.click();
    const dialog = page.getByRole('dialog', { name: `Bin labels for ${STOCK_JOURNEY.hub.name}` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('4 labels, one for each bin of this hub.');
    await expectNoAxeViolations(page);
    await snap(page, 'labels-hub-dialog', { element: dialog });

    await dialog.getByRole('button', { name: 'Print labels' }).click();
    await expect(dialog.getByText('The labels are ready to print.')).toBeVisible({
      timeout: 45_000,
    });
    await expectNoAxeViolations(page);
    await expectSheetOpens(page, () =>
      dialog.getByRole('button', { name: 'Open the labels' }).click(),
    );

    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(dialog).toBeHidden();
    await expect(print).toBeFocused();
  });

  test('prints a serial’s label again, saying why', async ({ page }) => {
    const item = LABEL_JOURNEY.items[projectName()];
    await page.goto(`/inventory/stock?q=${item.sku}`);
    const list = dataGrid(page, 'Stock by hub, bin and item');
    await rowOf(list, item.sku).first().getByRole('link', { name: item.name }).click();
    await expect(page.getByRole('heading', { name: item.name, level: 1 })).toBeVisible();
    await dataGrid(page, 'Stock movements, newest first')
      .getByRole('link', { name: item.serialNo })
      .first()
      .click();
    await expect(
      page.getByRole('heading', { name: `Serial number ${item.serialNo}`, level: 1 }),
    ).toBeVisible();

    const again = await hydrated(page.getByRole('button', { name: 'Print the label again' }));
    await again.click();
    const dialog = page.getByRole('dialog', { name: `New label for ${item.serialNo}` });
    await expect(dialog).toBeVisible();
    await snap(page, 'labels-reprint-dialog', { element: dialog });

    // Why is needed before anything prints.
    await dialog.getByRole('button', { name: 'Print the label' }).click();
    await expect(dialog.getByText('Say why in 3 to 300 characters.')).toBeVisible();
    await expectNoAxeViolations(page);

    await dialog.getByLabel('Why it needs a new label').fill('The label is torn at the corner');
    await dialog.getByRole('button', { name: 'Print the label' }).click();
    await expect(dialog.getByText('The label is ready to print.')).toBeVisible({
      timeout: 45_000,
    });
    await expectNoAxeViolations(page);
    await expectSheetOpens(page, () =>
      dialog.getByRole('button', { name: 'Open the labels' }).click(),
    );

    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(dialog).toBeHidden();
    await expect(again).toBeFocused();
  });
});

/** The print module's label template, its fixtures and the renderer, once the JSON step is set. */
async function labelModules() {
  loadCatalogueAsModule();
  const [template, fixtures, renderer] = await Promise.all([
    import('../src/print/label-template'),
    import('../src/print/fixtures/spike-documents'),
    import('../src/print/renderer'),
  ]);
  return { ...template, ...fixtures, ...renderer };
}

/** A PNG's pixels, read by the browser: the runner in the Linux image loads nothing native. */
async function pixelsOf(page: Page, png: Buffer) {
  return page.evaluate(async (base64) => {
    const picture = new Image();
    picture.src = `data:image/png;base64,${base64}`;
    await picture.decode();
    const canvas = document.createElement('canvas');
    canvas.width = picture.naturalWidth;
    canvas.height = picture.naturalHeight;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no canvas');
    context.drawImage(picture, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    return { data: Array.from(data), width, height };
  }, png.toString('base64'));
}

test.describe('labels as Chromium prints them (INV-07)', () => {
  test.beforeEach(() => {
    // One project is enough: the labels print the same whatever the screen.
    test.skip(projectName() !== 'desktop-light', 'labels are printed once');
  });

  test('every kind’s QR code reads back to its payload at the thermal printer’s 203 dpi', async ({
    page,
  }) => {
    const m = await labelModules();
    const renderer = await m.createPrintRenderer(await m.chromiumForRuntime());
    try {
      const sheets = [
        { labels: m.spikeLabels(2), size: '50x25' },
        { labels: m.spikeBinLabels(2), size: '50x25' },
        { labels: m.spikePackageLabels(2), size: '100x50' },
      ] as const;
      for (const { labels, size } of sheets) {
        for (const label of labels) {
          const png = await renderer.renderImage(
            await m.renderLabelsHtml([label], size),
            '.label',
            203,
          );
          const { data, width, height } = await pixelsOf(page, png);
          const read = jsQR(Uint8ClampedArray.from(data), width, height);
          expect.soft(read?.data, `${label.kind} ${size}`).toBe(label.qrPayload);
        }
      }
    } finally {
      await renderer.close();
    }
  });

  test('a sheet of 500 labels prints well inside the render route’s 60 seconds', async () => {
    const m = await labelModules();
    const renderer = await m.createPrintRenderer(await m.chromiumForRuntime());
    try {
      // Warm, as a worker that has printed before.
      await renderer.renderLabel(await m.renderLabelsHtml(m.spikeLabels(1), '50x25'), '50x25');
      const started = Date.now();
      const pdf = await renderer.renderLabel(
        await m.renderLabelsHtml(m.spikeLabels(500), '50x25'),
        '50x25',
      );
      const took = Date.now() - started;
      test.info().annotations.push({ type: '500 labels', description: `${String(took)} ms` });
      expect(m.pageCount(pdf)).toBe(500);
      // The route allows 60 seconds; a cold start adds a few. Measured at about 1 second warm.
      expect(took).toBeLessThan(20_000);
    } finally {
      await renderer.close();
    }
  });
});
