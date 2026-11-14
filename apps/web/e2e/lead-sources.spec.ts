import type { Page } from '@playwright/test';
import { expect, expectNoAxeViolations, hydrated, signedInAs, test } from './support/fixtures';
import { snap } from './support/snap';

// I1 Lead Ads, lead forms and website ingest (docs/03-roadmap-appendix/phase2.md §6.2): an
// Executive connects a company's website and matches its questions on Settings › Lead sources,
// makes a website key (shown once) and turns it off; a tele-caller records a lead's details on the
// qualification card from the leads board; Integration health lists the leads from other systems
// that nobody owns. Company 4's sources and keys are this journey's alone.

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

async function openLeadSources(page: Page): Promise<void> {
  await page.goto('/settings/lead-sources');
  await expect(page.getByRole('heading', { name: 'Lead sources', level: 1 })).toBeVisible();
  const company = await hydrated(page.getByLabel('Company', { exact: true }));
  await company.selectOption({ label: 'RCREF' });
  await expect(page.getByRole('heading', { name: 'Forms and websites' })).toBeVisible();
}

test.describe('lead sources as an Executive', () => {
  test.use(signedInAs('executive'));

  test('connects a website, matches its questions, and makes and turns off a key', async ({
    page,
  }, testInfo) => {
    // One project changes company 4's sources, so two browsers never edit them at once.
    test.skip(testInfo.project.name !== 'desktop-light', 'the sources are edited in one project');
    await openLeadSources(page);
    const run = String(Date.now()).slice(-6);
    const host = `rcref-${run}.example`;
    const name = `RCREF website ${run}`;

    await page.getByRole('button', { name: 'Connect a form' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Connect a form' })).toBeVisible();
    await dialog.getByLabel('Kind of form').selectOption({ label: 'Company website' });
    await dialog.getByLabel('Website address').fill(host);
    await dialog.getByLabel('Name shown here').fill(name);
    await dialog.getByLabel('Line of business').selectOption({ label: 'Farmer Pumps' });
    // No lead has come in, so the questions are added by their IDs.
    await expect(dialog.getByText(/No lead has come in yet/)).toBeVisible();
    for (const key of ['name', 'mobile', 'agree']) {
      await dialog.getByLabel('Add a question').fill(key);
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(dialog.getByText(/Match a name question and the mobile number/)).toBeVisible();
    await dialog.getByLabel('name', { exact: true }).selectOption({ label: 'Full name' });
    await dialog.getByLabel('mobile', { exact: true }).selectOption({ label: 'Mobile number' });
    await expect(dialog.getByText(/Match a name question and the mobile number/)).toHaveCount(0);
    await dialog.getByLabel('Consent question').selectOption({ label: 'agree' });
    await dialog.getByLabel('Version of the consent wording').fill('2026-11 website');
    await dialog.getByLabel('Calls').check();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Save form' }).click();
    await expect(page.getByText(`${name} is saved.`)).toBeVisible();

    const item = page
      .getByRole('list', { name: 'Forms and websites' })
      .getByRole('listitem')
      .filter({ hasText: name });
    await expect(item.getByText('Name and phone matched')).toBeVisible();
    await expect(item.getByText('Has a consent question')).toBeVisible();
    await expect(item.getByText('No lead has come in from it yet.')).toBeVisible();

    // A key, shown once, then listed by its last four characters, and turned off.
    const label = `Website key ${run}`;
    await page.getByLabel('Name of the new key').fill(label);
    await page.getByRole('button', { name: 'Make a key' }).click();
    const shown = page.getByRole('status').filter({ hasText: `The key for ${label}` });
    await expect(shown).toBeVisible();
    const secret = (await shown.locator('code').textContent()) ?? '';
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expectNoAxeViolations(page);
    await shown.getByRole('button', { name: 'I have copied it' }).click();
    await expect(page.getByText(secret)).toHaveCount(0);
    const key = page
      .getByRole('list', { name: 'Website keys' })
      .getByRole('listitem')
      .filter({ hasText: label });
    await expect(key.getByText(`Ends with ${secret.slice(-4)}`)).toBeVisible();
    await key.getByRole('button', { name: `Turn off ${label}` }).click();
    await expect(key.getByText(/^Turned off on /)).toBeVisible();

    // Disconnected, the website leaves the list.
    await item.getByRole('button', { name: `Disconnect ${name}` }).click();
    await expect(page.getByText(`${name} is disconnected.`)).toBeVisible();
    await expect(item).toHaveCount(0);
  });

  test('shows the screen', async ({ page }) => {
    await openLeadSources(page);
    await expect(page.getByRole('heading', { name: 'Website keys' })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'lead-sources', {
      mask: [
        page.getByRole('list', { name: 'Forms and websites' }),
        page.getByRole('list', { name: 'Website keys' }),
      ],
    });
  });

  test('lists the leads from other systems that nobody owns on Integration health', async ({
    page,
  }) => {
    await page.goto('/admin/integrations');
    await expect(page.getByRole('heading', { name: 'Leads nobody has yet' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('the qualification card as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('records a lead’s details from the leads board', async ({ page }) => {
    const name = `Bhanwar Lal ${String(Date.now()).slice(-6)}`;
    await page.goto('/leads/new');
    await page.getByLabel('Customer name').fill(name);
    await page.getByLabel('Mobile number').fill(freshMobile());
    await page.getByLabel('Line of business').selectOption({ label: 'Farmer Pumps' });
    await page.getByLabel('Type of customer').selectOption({ label: 'Farm' });
    await page.getByRole('button', { name: 'Save lead' }).click();
    await expect(page.getByText(`Lead saved for ${name}.`)).toBeVisible({ timeout: 30_000 });

    await page.goto('/leads/board?pipeline=farmer_pumps');
    await (await hydrated(page.getByRole('button', { name: `Actions for ${name}` }))).click();
    await page.getByRole('menuitem', { name: 'Lead details' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: `Lead details of ${name}` })).toBeVisible();
    await expect(dialog.getByText('No details recorded yet.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Change details' }).click();
    await dialog.getByLabel('Pump depth (feet)').fill('320');
    await dialog.getByLabel('Monthly electricity bill (rupees)').fill('1800');
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('The lead details are saved.')).toBeVisible();
    await expect(dialog.getByText('320')).toBeVisible();
    await expect(dialog.getByText('1,800')).toBeVisible();
  });
});
