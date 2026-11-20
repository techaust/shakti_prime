import type { Page } from '@playwright/test';
import type { VoicePageMessage, VoiceRoomMessage } from '@shakti/contracts';
import type { VoiceConnection } from '../src/components/voice/room';
import {
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';

// Talk to Shakti (docs/03-roadmap-appendix/phase2.md §7.5, PRD AI-03) on a fake room: the page
// reaches its room through a port, and takes the room installed at `window.shaktiVoiceRoom` in
// place of LiveKit's. This journey puts a room there that records what the page sends and lets
// the test speak as the worker and as the network (the LiveKit adapter has its own unit tests). The session route is answered here too, since no LiveKit
// project serves the journeys; the route and the worker are tested on their own (src/voice,
// tests/voice-*.test.ts, apps/voice-agent). The Playbook draft is saved for real.

declare global {
  interface Window {
    voiceSent?: VoicePageMessage[];
    voiceEmit?: (message: VoiceRoomMessage) => void;
    voiceMicrophone?: boolean[];
    voiceConnection?: (connection: VoiceConnection) => void;
    voiceSoundBlocked?: (blocked: boolean) => void;
    voiceSoundStarted?: number;
    voiceLeft?: number;
  }
}

/**
 * Installs the fake room before the page loads. The session route answers a talk, or, once
 * `refuseNext()` is called, the day's limit for the next start.
 */
async function fakeRoom(page: Page): Promise<{ refuseNext: () => void }> {
  let refuse = false;
  await page.addInitScript(() => {
    window.voiceSent = [];
    window.voiceMicrophone = [];
    window.voiceSoundStarted = 0;
    window.voiceLeft = 0;
    window.shaktiVoiceRoom = () =>
      Promise.resolve({
        onMessage: (handler: (message: VoiceRoomMessage) => void) => {
          window.voiceEmit = handler;
        },
        onConnection: (handler: (connection: VoiceConnection) => void) => {
          window.voiceConnection = handler;
        },
        onSoundBlocked: (handler: (blocked: boolean) => void) => {
          window.voiceSoundBlocked = handler;
        },
        startSound: () => {
          window.voiceSoundStarted = (window.voiceSoundStarted ?? 0) + 1;
          window.voiceSoundBlocked?.(false);
          return Promise.resolve();
        },
        send: (message: VoicePageMessage) => {
          window.voiceSent?.push(message);
          return Promise.resolve();
        },
        setMicrophone: (on: boolean) => {
          window.voiceMicrophone?.push(on);
          return Promise.resolve();
        },
        leave: () => {
          window.voiceLeft = (window.voiceLeft ?? 0) + 1;
          return Promise.resolve();
        },
      });
  });
  const session = '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a0e';
  await page.route('**/api/v1/voice/session', (route) => {
    if (refuse) {
      refuse = false;
      return route.fulfill({
        status: 403,
        json: {
          error: {
            code: 'forbidden',
            message: 'refused',
            requestId: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a0f',
            details: { reason: 'voice_cap_reached' },
          },
        },
      });
    }
    return route.fulfill({
      json: {
        sessionId: session,
        livekit: {
          url: 'wss://livekit.journeys.invalid',
          roomName: session,
          participantToken: 'journeys.room.token',
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        },
        // Fewer than the server's own count, so the journey sees the day's minutes read again.
        limits: { minutesRemainingToday: 20, maxSessionMinutes: 15 },
      },
    });
  });
  return {
    refuseNext: () => {
      refuse = true;
    },
  };
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
    const session = await fakeRoom(page);
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
    // The talk's own minutes, apart from the day's: 3 of the 20 left today used.
    await expect(live.getByText('12 minutes left in this talk')).toBeVisible();
    await expect(page.getByText('17 minutes left today')).toBeVisible();

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

    // The network drops and comes back; the browser holds Shakti's voice until sound is turned on.
    await page.evaluate(() => {
      window.voiceConnection?.('reconnecting');
    });
    await expect(page.getByText('The connection dropped.', { exact: false })).toBeVisible();
    await page.evaluate(() => {
      window.voiceConnection?.('connected');
    });
    await expect(page.getByText('The connection dropped.', { exact: false })).toHaveCount(0);
    await page.evaluate(() => {
      window.voiceSoundBlocked?.(true);
    });
    await page.getByRole('button', { name: 'Turn on sound' }).click();
    await expect(page.getByRole('button', { name: 'Turn on sound' })).toHaveCount(0);
    expect(await page.evaluate(() => window.voiceSoundStarted)).toBe(1);

    // A weak connection: push-to-talk and the text box.
    await worker(page, { type: 'state', state: 'push_to_talk' });
    await expect(page.getByText('The connection is weak.', { exact: false })).toBeVisible();
    // The microphone is off until the hold button is held.
    await expect.poll(() => page.evaluate(() => window.voiceMicrophone?.at(-1))).toBe(false);
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
    await worker(page, { type: 'minutes', minutesLeft: 0 });
    await expect(live.getByText('No time left in this talk')).toBeVisible();
    await worker(page, { type: 'ended', reason: 'time_up' });
    await expect(page.getByText('This talk reached its time.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start another talk' })).toBeVisible();
    expect(await page.evaluate(() => window.voiceLeft)).toBe(1);
    // The day's minutes come from the server again (this journey's talks write nothing there),
    // and the recording question is asked again before the next talk.
    await expect(page.getByText('30 minutes left today')).toBeVisible();
    await expect(page.getByLabel('No recording')).not.toBeChecked();
    await expect(page.getByLabel('Yes, keep a recording')).not.toBeChecked();
    await expect(start).toBeDisabled();
    await page.getByLabel('No recording').check();
    await expect(start).toBeEnabled();

    // Another talk, whose connection is lost for good: the page leaves the room and says so.
    await start.click();
    await expect(live).toBeVisible();
    await page.evaluate(() => {
      window.voiceConnection?.('lost');
    });
    await expect(page.getByText('The connection was lost', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => window.voiceLeft)).toBe(2);
    await expect(start).toBeDisabled();

    // A start the BOS refuses: the reason, and the recording question asked again.
    session.refuseNext();
    await page.getByLabel('Yes, keep a recording').check();
    await start.click();
    await expect(page.getByText("You have used today's time for talking to Shakti.")).toBeVisible();
    await expect(page.getByLabel('Yes, keep a recording')).not.toBeChecked();
    await expect(start).toBeDisabled();
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
