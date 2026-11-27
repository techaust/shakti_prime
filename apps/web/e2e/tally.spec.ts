import { expect, expectNoAxeViolations, hydrated, signedInAs, test } from './support/fixtures';
import { snap } from './support/snap';

// TC2 Tally ingest (docs/03-roadmap-appendix/phase5.md §6.3): an Executive sets up a Tally
// connector on Admin › Integrations › Tally (its number and key shown once), links a Tally
// company, makes a new key and turns the old one off, unlinks the company and turns the connector
// off; Accounts open Tally checks, where no check waits; Integration health lists the Tally
// section. Each connector is this journey's own run.

test.describe('the Tally connector as an Executive', () => {
  test.use(signedInAs('executive'));
  test.describe.configure({ mode: 'serial' });

  test('sets up a connector, links a company, rotates its key and turns it off', async ({
    page,
  }, testInfo) => {
    // One project changes the connectors, so two browsers never edit them at once.
    test.skip(
      testInfo.project.name !== 'desktop-light',
      'the connectors are edited in one project',
    );
    await page.goto('/admin/integrations/tally');
    await expect(page.getByRole('heading', { name: 'Tally connector', level: 1 })).toBeVisible();
    const run = String(Date.now()).slice(-6);
    const name = `Office computer ${run}`;
    await (await hydrated(page.getByLabel('Connector name'))).fill(name);
    await page.getByRole('button', { name: 'Set up connector' }).click();
    const shown = page.getByRole('status').filter({ hasText: `${name} is set up` });
    await expect(shown).toBeVisible();
    await expect(shown.getByText('This key is shown only once')).toBeVisible();
    await expectNoAxeViolations(page);
    await shown.getByRole('button', { name: 'I have copied the key' }).click();
    await expect(shown).toHaveCount(0);

    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) });
    await expect(card.getByText('Has not checked in yet')).toBeVisible();
    await card.getByLabel('Our company').selectOption({ label: 'RCREF' });
    await card.getByLabel('Tally company name').fill(`RCREF ${run} 2026-27`);
    await card.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(page.getByText('The Tally company is linked.')).toBeVisible();
    await expect(card.getByText(`RCREF ${run} 2026-27, records go to RCREF`)).toBeVisible();

    await card.getByRole('button', { name: 'Make a new key' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `A new key for ${name}` }),
    ).toBeVisible();
    await expect(card.getByText(/New key ends with/)).toBeVisible();
    await card.getByRole('button', { name: 'Turn old key off' }).click();
    await expect(page.getByText('The old key is turned off.')).toBeVisible();
    await expect(card.getByText(/New key ends with/)).toHaveCount(0);

    await card.getByRole('button', { name: 'Unlink the Tally company from RCREF' }).click();
    await expect(page.getByText('The Tally company is unlinked.')).toBeVisible();
    await card.getByRole('button', { name: `Turn off ${name}` }).click();
    await expect(page.getByText(`${name} is turned off.`)).toBeVisible();
    await expect(card.getByText('Turned off', { exact: true })).toBeVisible();
  });

  test('Integration health shows the Tally section', async ({ page }) => {
    await page.goto('/admin/integrations');
    await expect(page.getByRole('heading', { name: 'Tally', level: 2 })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('Tally checks as Accounts', () => {
  test.use(signedInAs('accounts'));

  test('lists the checks waiting, none here', async ({ page }) => {
    await page.goto('/tally-checks');
    await expect(page.getByRole('heading', { name: 'Tally checks', level: 1 })).toBeVisible();
    await expect(page.getByText('No check is waiting.')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'tally-checks-empty');
  });

  test("cannot open the connectors, an Executive's screen", async ({ page }) => {
    await page.goto('/admin/integrations/tally');
    await expect(page.getByRole('heading', { name: 'Tally connector', level: 1 })).toHaveCount(0);
  });
});
