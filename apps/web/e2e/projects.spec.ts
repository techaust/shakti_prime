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
import { PROJECT_JOURNEY, PROJECTS, SNAPSHOT_COMPANY } from './support/users';

// J1's project screens (docs/03-roadmap-appendix/phase4.md §6.1). The seed gives each journey
// project, in company 1, two projects of the journeys' customer with the five standard steps all
// open (`e2e/setup/projects.ts`): the Project Manager's, which the Project Manager takes through
// its first steps, puts on hold and resumes; and one the Field Engineer is on, which nobody moves,
// so the engineer's list shows the same rows every run. No name or number here is client data.

const NOT_FOUND = /^We couldn[’']t find this screen$/;

function projectHref(id: string): string {
  return `/projects/${String(PROJECT_JOURNEY.entityId)}/${id}`;
}

test.describe('as the Project Manager, a drafted project', () => {
  test.use(signedInAs('projectManager'));

  test('is found in the list, its steps done in order, put on hold and resumed', async ({
    page,
  }) => {
    const project = projectName();
    const projectNo = PROJECT_JOURNEY.managed[project];
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    const list = dataGrid(page, 'Projects');
    await expect(rowOf(list, projectNo)).toBeVisible();
    await expectNoAxeViolations(page);

    await rowOf(list, projectNo).getByRole('link', { name: projectNo }).click();
    await expect(page.getByRole('heading', { name: projectNo, level: 1 })).toBeVisible();
    await expect(page.getByText(PROJECT_JOURNEY.customer)).toBeVisible();
    const steps = page.getByRole('list').filter({ hasText: 'Site survey' });
    await expect(steps).toContainText('Material dispatched');
    await expectNoAxeViolations(page);
    await snap(page, 'project-page');

    // The steps are done in order: only the next one offers Mark done.
    await expect(page.getByRole('button', { name: 'Mark done' })).toHaveCount(1);
    await (await hydrated(page.getByRole('button', { name: 'Mark done' }))).click();
    await expect(page.getByText('Step marked done.')).toBeVisible();
    await expect(
      steps
        .getByRole('listitem')
        .filter({ hasText: 'Site survey' })
        .getByText('Done', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Mark done' }).click();
    await expect(
      steps
        .getByRole('listitem')
        .filter({ hasText: 'Material dispatched' })
        .getByText('Done', { exact: true }),
    ).toBeVisible();

    // On hold with a reason, then resumed.
    await page.getByRole('button', { name: 'Put on hold' }).click();
    const hold = page.getByRole('dialog', { name: `Put ${projectNo} on hold` });
    await expect(hold).toBeVisible();
    await hold.getByRole('button', { name: 'Put on hold' }).click();
    await expect(hold.getByText('Write the reason.')).toBeVisible();
    await hold.getByLabel('Reason').fill('Waiting for the borewell to be cleaned');
    await snap(page, 'project-hold-dialog', { element: hold });
    await expectNoAxeViolations(page);
    await hold.getByRole('button', { name: 'Put on hold' }).click();
    await expect(page.getByText('Project put on hold.')).toBeVisible();
    await expect(
      page.getByText('On hold because: Waiting for the borewell to be cleaned'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark done' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('Project resumed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark done' })).toHaveCount(1);
  });
});

test.describe('as the Field Engineer', () => {
  test.use(signedInAs('fieldEngineer'));

  test('sees only the projects they are on, and no other', async ({ page }) => {
    const project = projectName();
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    const list = dataGrid(page, 'Projects');
    for (const each of PROJECTS) {
      await expect(rowOf(list, PROJECT_JOURNEY.engineered[each])).toBeVisible();
      await expect(rowOf(list, PROJECT_JOURNEY.managed[each])).toHaveCount(0);
    }
    await expectNoAxeViolations(page);
    await snap(page, 'projects-engineer');

    const mine = PROJECT_JOURNEY.engineered[project];
    await rowOf(list, mine).getByRole('link', { name: mine }).click();
    await expect(page.getByRole('heading', { name: mine, level: 1 })).toBeVisible();
    await expect(page.getByText(PROJECT_JOURNEY.customer)).toBeVisible();
    await expect(page.getByText(PROJECT_JOURNEY.village, { exact: false })).toBeVisible();
    // The engineer marks steps done, and makes none of a manager's moves.
    await expect(page.getByRole('button', { name: 'Mark done' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Put on hold' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change people' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'project-page-engineer');

    // A project they are not on is not there for them.
    await page.goto(projectHref(PROJECT_JOURNEY.ids.managed[project]));
    await expect(page.getByRole('heading', { name: NOT_FOUND })).toBeVisible();
  });
});

test.describe('as the Executive, Settings › Project steps', () => {
  test.use(signedInAs('executive'));

  test('shows each business line’s steps and opens the editor', async ({ page }) => {
    await page.goto(`/settings/project-steps?company=${String(SNAPSHOT_COMPANY.entityId)}`);
    await expect(page.getByRole('heading', { name: 'Project steps', level: 1 })).toBeVisible();
    const pumps = page.getByRole('region', { name: 'Farmer pumps' });
    await expect(pumps).toContainText('Site survey');
    await expectNoAxeViolations(page);
    await snap(page, 'project-steps');
    await (await hydrated(pumps.getByRole('button', { name: 'Change steps' }))).click();
    const editor = page.getByRole('form', { name: 'Steps for Farmer pumps' });
    await expect(editor.getByLabel('Step 1', { exact: true })).toHaveValue('Site survey');
    await editor.getByRole('button', { name: 'Add a step' }).click();
    await expect(editor.getByLabel('Step 6', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await editor.getByRole('button', { name: 'Cancel' }).click();
    await expect(pumps.getByRole('button', { name: 'Change steps' })).toBeVisible();
  });
});
