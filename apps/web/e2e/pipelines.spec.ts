import {
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { ADDED_PARTNERS, REFERRAL_PARTNER, type ProjectName } from './support/users';

/**
 * The pipeline whose stages each project's journeys add, move, rename and archive. Run locally,
 * the projects share one database, and a new stage order names every open stage of the pipeline,
 * so a stage another project added to the same pipeline meanwhile would make the move refused.
 * Farmer Pumps is left alone: the leads board's picture shows its stages (leads.spec.ts).
 */
const STAGE_PIPELINE: Record<ProjectName, string> = {
  'desktop-light': 'Commercial EPC',
  'desktop-dark': 'Residential Rooftop',
  phone: 'Dealer and Wholesale',
};

/** Every stage these journeys make starts so, and the seed archives any a stopped run left. */
const JOURNEY_STAGE = 'Site survey';

/** A stage name of this attempt alone, so a retry never meets the first attempt's. */
function journeyStageName(): string {
  return `${JOURNEY_STAGE} ${String(Date.now()).slice(-6)}`;
}

test.describe('Settings › Pipelines as an Executive', () => {
  test.use(signedInAs('executive'));
  // The screenshot comes first and the stage journey leaves the pipeline as it found it, so the
  // two never run at once in one project (CI gives each project its own database).
  test.describe.configure({ mode: 'serial' });

  test('shows every pipeline with its stages, the call outcomes and the score rules', async ({
    page,
  }) => {
    await page.goto('/settings/pipelines');
    await expect(
      page.getByRole('heading', { name: 'Pipelines and call outcomes', level: 1 }),
    ).toBeVisible();
    for (const name of ['Farmer Pumps', 'Residential Rooftop', 'Commercial EPC']) {
      await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible();
    }
    const farmer = page.getByRole('article', { name: 'Farmer Pumps' });
    // New, Qualified and Quoted are kept by every pipeline: renamed, never archived.
    for (const kept of ['New', 'Qualified', 'Quoted']) {
      await expect(farmer.getByRole('button', { name: `Edit ${kept}` })).toBeVisible();
      await expect(farmer.getByRole('button', { name: `Archive ${kept}` })).toHaveCount(0);
    }
    await expect(farmer.getByRole('button', { name: 'Archive Contacted' })).toBeVisible();
    // The two list editors load after the pipelines.
    await expect(page.getByRole('button', { name: 'Save outcomes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save rules' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Referral partners and commission', level: 2 }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add commission rule' })).toBeVisible();
    await expectNoAxeViolations(page);
    // The projects run side by side, so another project's add journey may already have put its
    // partner on the list. Those rows leave the picture (a mask would keep their height), so the
    // page shows the seeded partners alone whichever project runs first.
    const added = Object.values(ADDED_PARTNERS);
    await page
      .getByRole('list', { name: 'Referral partners' })
      .getByRole('listitem')
      .filter({ hasText: new RegExp(added.join('|')) })
      .evaluateAll((rows) => {
        for (const row of rows) row.remove();
      });
    // So do the stages the other projects' stage journeys have made and not yet archived.
    await page
      .getByRole('list', { name: /^Stages of / })
      .getByRole('listitem')
      .filter({ hasText: JOURNEY_STAGE })
      .evaluateAll((rows) => {
        for (const row of rows) row.remove();
      });
    await snap(page, 'settings-pipelines');
  });

  test('lists the referral partners with their codes and checks a commission rule before saving', async ({
    page,
  }) => {
    await page.goto('/settings/pipelines');
    const partners = page.getByRole('list', { name: 'Referral partners' });
    const partner = partners.getByRole('listitem').filter({ hasText: REFERRAL_PARTNER.name });
    await expect(partner).toContainText(`Code ${REFERRAL_PARTNER.code}`);
    await expect(partner).toContainText('Code accepted');

    // The code dialog opens with the partner's code and closes without a change. The two editors
    // load after the pipelines, so each is clicked or typed into only once React has taken it over
    // (a click before that was lost on a loaded machine, and the journey passed only on its retry).
    const setCode = partner.getByRole('button', {
      name: `Set code for ${REFERRAL_PARTNER.name}`,
    });
    await (await hydrated(setCode)).click();
    const dialog = page.getByRole('dialog', { name: 'Set a referral code' });
    await expect(dialog.getByLabel('Referral code')).toHaveValue(REFERRAL_PARTNER.code);
    await expect(dialog.getByLabel('Accept this code on new leads')).toBeChecked();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(setCode).toBeFocused();

    // A date that does not exist is answered on the form, and no rule is saved.
    const form = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Add commission rule' }) });
    await expect(
      form.getByLabel('Partner').locator('option', { hasText: REFERRAL_PARTNER.name }),
    ).toHaveCount(1);
    await (await hydrated(form.getByLabel('Amount'))).fill('500');
    await form.getByLabel('From').fill('31022031');
    await expect(form.getByText('Enter a real date as DD-MM-YYYY.')).toBeVisible();
    await form.getByRole('button', { name: 'Add commission rule' }).click();
    await expect(page.getByText('The commission rule is saved.')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('adds a referral partner with no lead, and refuses a number that is a customer already', async ({
    page,
  }) => {
    const name = ADDED_PARTNERS[projectName()];
    // A number and a code of this attempt alone, so a retry never meets the first attempt's.
    const stamp = String(Date.now());
    const mobile = `9${stamp.slice(-9)}`;
    const code = `GM${stamp.slice(-8)}`;
    await page.goto('/settings/pipelines');
    const add = page.getByRole('button', { name: 'Add partner' });
    await (await hydrated(add)).click();
    const dialog = page.getByRole('dialog', { name: 'Add a referral partner' });
    await expect(dialog.getByLabel('Company')).toBeVisible();
    await expectNoAxeViolations(page);

    // The seeded partner's number belongs to a customer already: the form says so under the box.
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByLabel('Mobile number').fill(REFERRAL_PARTNER.phone);
    await dialog.getByRole('button', { name: 'Add partner' }).click();
    const phoneBox = dialog.getByLabel('Mobile number');
    await expect(phoneBox).toHaveAttribute('aria-invalid', 'true');
    await expect(
      dialog.getByText('This number already belongs to a customer.', { exact: false }),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    await phoneBox.fill(mobile);
    await dialog.getByLabel('Referral code').fill(code.toLowerCase());
    await dialog.getByRole('button', { name: 'Add partner' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(`${name} is added as a referral partner.`)).toBeVisible();
    await expect(add).toBeFocused();
    const partner = page
      .getByRole('list', { name: 'Referral partners' })
      .getByRole('listitem')
      .filter({ hasText: name });
    await expect(partner).toContainText(`Code ${code}`);
    await expect(partner).toContainText('Code accepted');
    // The new partner can be chosen for a commission rule at once.
    const form = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Add commission rule' }) });
    await expect(form.getByLabel('Partner').locator('option', { hasText: name })).toHaveCount(1);
  });

  test('adds a stage, moves it up and archives it', async ({ page }) => {
    const pipeline = STAGE_PIPELINE[projectName()];
    await page.goto('/settings/pipelines');
    const card = page.getByRole('article', { name: pipeline });
    const name = journeyStageName();
    await (await hydrated(card.getByLabel('New stage name'))).fill(name);
    await card.getByRole('button', { name: 'Add stage' }).click();
    await expect(page.getByText(`${name} is added as the last open stage.`)).toBeVisible();

    const stages = card.getByRole('list', { name: `Stages of ${pipeline}` });
    const added = stages.getByRole('listitem').filter({ hasText: name });
    await expect(added).toBeVisible();
    // The stages in the order the card lists them, by the names their Edit buttons carry.
    const order = (): Promise<string[]> =>
      stages
        .getByRole('button', { name: /^Edit / })
        .evaluateAll((buttons) =>
          buttons.map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Edit /, '')),
        );
    const before = await order();
    const at = before.indexOf(name);
    // Added as the last open stage, so an open stage sits above it.
    expect(at).toBeGreaterThan(0);
    const above = before[at - 1] ?? '';
    // The move buttons keep their visible words as their name and say which stage they move.
    const up = added.getByRole('button', { name: 'Move up' });
    await expect(up).toHaveAccessibleDescription(name);
    await up.click();
    await expect(page.getByText('The new order of stages is saved.')).toBeVisible();
    // The stage and the one above it change places, and every other stage keeps its place.
    await expect
      .poll(order)
      .toEqual([...before.slice(0, at - 1), name, above, ...before.slice(at + 1)]);

    await added.getByRole('button', { name: `Archive ${name}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Archive this stage?' });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Archive stage' }).click();
    await expect(page.getByText(`${name} is archived.`)).toBeVisible();
    await expect(stages.getByText(name)).toHaveCount(0);
  });

  test('a changed stage name is kept after the page is opened again', async ({ page }) => {
    // A stage of the journey's own, so another project's picture never shows a seeded stage
    // under a changed name.
    const pipeline = STAGE_PIPELINE[projectName()];
    const name = journeyStageName();
    const renamed = `${name} booked`;
    await page.goto('/settings/pipelines');
    const card = page.getByRole('article', { name: pipeline });
    await (await hydrated(card.getByLabel('New stage name'))).fill(name);
    await card.getByRole('button', { name: 'Add stage' }).click();
    await expect(page.getByText(`${name} is added as the last open stage.`)).toBeVisible();

    await card.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit a stage' });
    await dialog.getByLabel('Stage name').fill(renamed);
    await dialog.getByRole('button', { name: 'Save stage' }).click();
    await expect(page.getByText(`${renamed} is saved.`)).toBeVisible();

    await page.reload();
    const again = page.getByRole('article', { name: pipeline });
    await expect(again.getByRole('button', { name: `Edit ${renamed}` })).toBeVisible();
    await expect(again.getByRole('button', { name: `Edit ${name}`, exact: true })).toHaveCount(0);

    // The journey leaves the pipeline as it found it.
    await (await hydrated(again.getByRole('button', { name: `Archive ${renamed}` }))).click();
    const archive = page.getByRole('dialog', { name: 'Archive this stage?' });
    await archive.getByRole('button', { name: 'Archive stage' }).click();
    await expect(page.getByText(`${renamed} is archived.`)).toBeVisible();
  });
});

test.describe('Settings › Pipelines as a General Manager', () => {
  test.use(signedInAs('gm'));

  test('is not a screen the role may open', async ({ page }) => {
    await page.goto('/settings/pipelines');
    await expect(
      page
        .getByRole('heading', { name: 'We couldn’t find this screen' })
        .or(page.getByRole('heading', { name: "We couldn't find this screen" })),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pipelines' })).toHaveCount(0);
  });
});
