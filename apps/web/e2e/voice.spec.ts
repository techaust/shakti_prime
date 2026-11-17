import type { Page } from '@playwright/test';
import type { VoicePageMessage, VoiceRoomMessage } from '@shakti/contracts';
import {
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';

// Talk to Shakti (docs/03-roadmap-appendix/phase2.md §7.5, PRD AI-03) on a fake room: the
// browser's LiveKit client waits for the owner's go-ahead, so the page reaches its room through
// `window.shaktiVoiceRoom`, where this journey puts a room that records what the page sends and
// lets the test speak as the worker. The session route is answered here too, since no LiveKit
// project serves the journeys; the route and the worker are tested on their own (src/voice,
// tests/voice-*.test.ts, apps/voice-agent). The Playbook draft is saved for real.

declare global {
  interface Window {
    voiceSent?: VoicePageMessage[];
    voiceEmit?: (message: VoiceRoomMessage) => void;
    voiceMicrophone?: boolean[];
  }
}

/** Installs the fake room before the page loads. */
async function fakeRoom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.voiceSent = [];
    window.voiceMicrophone = [];
    window.shaktiVoiceRoom = () =>
      Promise.resolve({
        onMessage: (handler: (message: VoiceRoomMessage) => void) => {
          window.voiceEmit = handler;
        },
        send: (message: VoicePageMessage) => {
          window.voiceSent?.push(message);
          return Promise.resolve();
        },
        setMicrophone: (on: boolean) => {
          window.voiceMicrophone?.push(on);
          return Promise.resolve();
        },
        leave: () => Promise.resolve(),
      });
  });
  const session = '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a0e';
  await page.route('**/api/v1/voice/session', (route) =>
    route.fulfill({
      json: {
        sessionId: session,
        livekit: {
          url: 'wss://livekit.journeys.invalid',
          roomName: session,
          participantToken: 'journeys.room.token',
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        },
        bosToken: { token: 'journeys.voice.token', expiresAt: new Date().toISOString() },
        limits: { minutesRemainingToday: 30, maxSessionMinutes: 15 },
      },
    }),
  );
}

/** The worker says something in the room. */
async function worker(page: Page, message: VoiceRoomMessage): Promise<void> {
  await page.evaluate((m) => {
    window.voiceEmit?.(m);
  }, message);
}

const sent = (page: Page) => page.evaluate(() => window.voiceSent ?? []);

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('answers the recording question, talks, sees captions and cards, and saves a Teach draft', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await fakeRoom(page);
    await page.goto('/voice');
    await expect(page.getByRole('heading', { name: 'Talk to Shakti', level: 1 })).toBeVisible();
    await expect(page.getByText('Answer the recording question to start.')).toBeVisible();
    const start = await hydrated(page.getByRole('button', { name: 'Start talking' }));
    // No talk starts without the recording answer.
    await expect(start).toBeDisabled();
    await expectNoAxeViolations(page);
    await snap(page, 'voice-start');

    await page.getByLabel('Teach Shakti how we work').check();
    await page.getByLabel('No recording').check();
    await expect(start).toBeEnabled();
    await start.click();

    const live = page.getByRole('region', { name: 'Your talk' });
    await expect(live).toBeVisible();
    await expect(page.getByRole('status', { name: 'What Shakti is doing' })).toHaveText(
      'Listening',
    );
    expect(await page.evaluate(() => window.voiceMicrophone)).toEqual([true]);

    await worker(page, { type: 'state', state: 'speaking' });
    await worker(page, {
      type: 'caption',
      speaker: 'person',
      text: 'Subsidy kab milti hai, yeh customers ko kaise batayein?',
      final: true,
    });
    await worker(page, {
      type: 'caption',
      speaker: 'shakti',
      text: 'Ji, pehle bataiye yeh kis ke liye hai: customers ya staff?',
      final: true,
    });
    await worker(page, { type: 'minutes', minutesLeft: 12 });
    await expect(page.getByRole('status', { name: 'What Shakti is doing' })).toHaveText('Speaking');
    const captions = page.getByRole('region', { name: 'What was said' });
    await expect(captions.getByRole('listitem')).toHaveCount(2);
    await expect(live.getByText('12 minutes left today')).toBeVisible();

    // An Ask answer's records, each a link to its screen.
    await worker(page, {
      type: 'cards',
      cards: [
        {
          kind: 'pipeline_stage',
          id: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8b01',
          label: 'Qualified',
          entityId: 1,
          accountId: null,
        },
      ],
    });
    await expect(
      page.getByRole('region', { name: 'Where this comes from' }).getByRole('link', {
        name: 'Qualified',
      }),
    ).toHaveAttribute('href', '/leads/board');
    await expectNoAxeViolations(page);
    await snap(page, 'voice-live');

    // A weak connection: push-to-talk and the text box.
    await worker(page, { type: 'state', state: 'push_to_talk' });
    await expect(page.getByText('The connection is weak.', { exact: false })).toBeVisible();
    const hold = page.getByRole('button', { name: 'Hold to talk' });
    await hold.focus();
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await page.getByLabel('Type instead').fill('Aur dealers ke liye?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect
      .poll(() => sent(page))
      .toEqual([
        { type: 'push_to_talk', held: true },
        { type: 'push_to_talk', held: false },
        { type: 'text', text: 'Aur dealers ke liye?' },
      ]);

    // Teach's drafts: asked for, shown, and saved by the person through the Playbook.
    await page.getByRole('button', { name: 'Make drafts' }).click();
    await expect.poll(async () => (await sent(page)).at(-1)).toEqual({ type: 'make_drafts' });
    const title = `Subsidy timing ${projectName()} ${Date.now().toString(36)}`;
    await worker(page, {
      type: 'draft',
      draft: {
        id: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8b02',
        type: 'faq',
        audience: 'customer',
        title,
        text: 'The subsidy is paid after the electricity company inspects the installation.',
      },
    });
    const draft = page.getByRole('article', { name: title });
    await expect(draft.getByText('Common question for Customers')).toBeVisible();
    await expectNoAxeViolations(page);
    await draft.getByRole('button', { name: 'Save draft' }).click();
    await expect(draft.getByText('Saved to the Playbook as a draft.')).toBeVisible();

    // The worker ends the talk at its time: the form is back, saying why.
    await worker(page, { type: 'ended', reason: 'time_up' });
    await expect(page.getByText('This talk reached its time.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start another talk' })).toBeVisible();
    await page.goto('/knowledge/playbook');
    await expect(page.getByText(title).first()).toBeVisible();
  });
});

test.describe('as Accounts', () => {
  test.use(signedInAs('accounts'));

  test('does not see Talk to Shakti', async ({ page }) => {
    await page.goto('/voice');
    await expect(page.getByRole('heading', { name: 'Talk to Shakti', level: 1 })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Talk to Shakti' })).toHaveCount(0);
  });
});
