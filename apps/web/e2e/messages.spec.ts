import { SNAPSHOT_COMPANY, WHATSAPP } from './support/users';
import {
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';

// WhatsApp chats (docs/03-roadmap-appendix/phase2.md §6.1, PRD WA-04). The seed records a new
// message from each project's customer of the tele-caller in company 1 on every run, so each
// project's chat waits for a reply with its window open. The journeys' app has no WhatsApp key, so a
// reply is queued and waits to be sent. No assistant answers chats yet, so the team answers each.

test.describe('as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('answers a waiting chat from Messages, which the team answers', async ({ page }) => {
    const customer = WHATSAPP.customers[projectName()];
    await page.goto('/messages');
    await expect(page.getByRole('heading', { name: 'Messages', level: 1 })).toBeVisible();
    const list = page.getByRole('region', { name: 'Chats waiting for a reply' });
    await hydrated(list.getByRole('button', { name: new RegExp(customer.name) }).first());
    await list
      .getByRole('button', { name: new RegExp(customer.name) })
      .first()
      .click();
    const chat = page.getByRole('region', { name: 'WhatsApp' });
    await expect(chat.getByText(WHATSAPP.customerMessage).last()).toBeVisible();
    await expectNoAxeViolations(page);

    // R goes to the reply box.
    await page.getByRole('heading', { name: 'Messages', level: 1 }).click();
    await page.keyboard.press('r');
    await expect(chat.getByLabel('Reply')).toBeFocused();
    const reply = `The engineer can visit on Friday ${String(Date.now()).slice(-5)}.`;
    await chat.getByLabel('Reply').fill(reply);
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Your message is on its way.')).toBeVisible();
    await expect(chat.getByText(reply)).toBeVisible();

    // No assistant answers chats yet: the team does, and nothing offers to give it back.
    await expect(chat.getByText('The team answers', { exact: true })).toBeVisible();
    await expect(
      chat.getByText(
        'Your team answers every WhatsApp chat. No assistant replies to customers yet.',
      ),
    ).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Give back to assistant' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('reads the chat on the customer’s page', async ({ page }) => {
    const customer = WHATSAPP.customers[projectName()];
    await page.goto('/customers');
    // Found by the phone's last digits, so the customer is listed however many the run has added.
    const search = page.getByRole('searchbox', { name: 'Find a customer' });
    await hydrated(search);
    await search.fill(customer.phone.replace(/\D/g, '').slice(-4));
    await search.press('Enter');
    await page.getByRole('link', { name: customer.name }).first().click();
    const section = page.getByRole('region', { name: 'WhatsApp' });
    await expect(section.getByText(WHATSAPP.customerMessage).first()).toBeVisible();
    await expect(section.getByLabel('Reply')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('as Accounts', () => {
  test.use(signedInAs('accounts'));

  test('has no Messages, which needs messaging.send', async ({ page }) => {
    await page.goto('/messages');
    await expect(page.getByRole('heading', { name: 'Messages', level: 1 })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Messages' })).toHaveCount(0);
  });
});

test.describe('as the snapshot company’s caller', () => {
  test.use(signedInAs('snapshotCaller'));

  test('sees the chat waiting for a reply, and moves through the list with J and K', async ({
    page,
  }) => {
    await page.goto('/messages');
    const list = page.getByRole('region', { name: 'Chats waiting for a reply' });
    const row = await hydrated(
      list.getByRole('button', { name: new RegExp(WHATSAPP.snapshot.customer.name) }),
    );
    await expect(row).toBeVisible();
    const chat = page.getByRole('region', { name: 'WhatsApp' });
    await expect(chat.getByText(WHATSAPP.snapshot.message)).toBeVisible();
    await expect(list.getByText(SNAPSHOT_COMPANY.name).first()).toBeVisible();
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await expect(row).toBeFocused();
    await expectNoAxeViolations(page);
    await snap(page, 'messages');
  });
});
