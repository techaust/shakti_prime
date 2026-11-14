import { writeWav } from '../src/integrations/voice/recording';
import {
  expect,
  expectNoAxeViolations,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { READER_RECORDING, SNAPSHOT_RECORDING } from './support/users';

// Vault recordings (docs/03-roadmap-appendix/phase2.md §6.4, K3). No speech service runs in the
// journeys (no `SARVAM_API_KEY`): a recording uploaded here waits for search until a person types
// its transcript, which the stand-in embeddings then read; the seed's two recordings were read with
// a transcript already. Every recording and transcript is synthetic.

/** Half a second of a quiet tone, as a 16-bit WAV. */
function recording(): Buffer {
  const samples = new Int16Array(8_000);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.round(600 * Math.sin((2 * Math.PI * 330 * i) / 16_000));
  }
  return Buffer.from(writeWav({ sampleRate: 16_000, channels: 1, samples }));
}

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('uploads a recording, types its transcript where no speech service runs, and finds it', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const word = `tank${projectName().replace(/[^a-z]/g, '')}${Date.now().toString(36)}`;
    const title = `Water tank visit ${word}`;
    await page.goto('/knowledge');
    await page.getByRole('button', { name: 'Add a file' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('For').selectOption({ label: 'Shakti Supreme' });
    await expect(
      dialog.getByText('or a recording as a WAV file up to 25 MB and 30 minutes', { exact: false }),
    ).toBeVisible();
    // An MP3 is refused before a byte is sent, with a sentence that asks for a WAV.
    const input = dialog.locator('input[type="file"]');
    await input.setInputFiles({ name: 'visit.mp3', mimeType: 'audio/mpeg', buffer: recording() });
    await expect(
      dialog.getByText('Save a recording as a WAV file first', { exact: false }),
    ).toBeVisible();
    await input.setInputFiles({ name: 'visit.wav', mimeType: 'audio/wav', buffer: recording() });
    await expect(dialog.getByText('Uploaded and checked. Add it to the vault.')).toBeVisible({
      timeout: 45_000,
    });
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Add to the vault' }).click();
    await expect(dialog).toBeHidden({ timeout: 45_000 });

    // No speech service here: the recording waits for search and says why.
    const card = page.getByRole('listitem').filter({ hasText: title });
    await expect(card.getByText('Waiting for search')).toBeVisible({ timeout: 45_000 });
    await expect(card.getByText('Recording')).toBeVisible();
    await card.getByRole('link', { name: title }).click();

    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await expect(page.getByLabel(`Play the recording ${title}`)).toBeVisible();
    await expect(page.getByText('Reading files for search is not switched on yet')).toBeVisible();
    await expectNoAxeViolations(page);

    const transcript = page.getByLabel('What was said');
    await page.getByRole('button', { name: 'Save transcript' }).click();
    await expect(page.getByText('Write what was said before you save.')).toBeVisible();
    await transcript.fill(`Tank ${word} ki safai har mahine. Customer ka number 9876543210 hai.`);
    await page.getByRole('button', { name: 'Save transcript' }).click();
    await expect(
      page.getByText('Saved. The recording is being read again for search from your transcript.'),
    ).toBeVisible();
    // Read again from the transcript, its phone number covered.
    await expect(page.getByText('Ready to search')).toBeVisible({ timeout: 45_000 });
    await expect(transcript).toHaveValue(/\[phone\]/);
    await expect(page.getByText('Corrected on')).toBeVisible();

    await page.goto('/knowledge');
    await page.getByLabel('What do you want to know?').fill(`tank ${word} ki safai`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const hit = page.getByRole('listitem').filter({ hasText: `From ${title}` });
    await expect(hit).toBeVisible({ timeout: 45_000 });
    await expect(
      hit.getByText(`Tank ${word} ki safai har mahine.`, { exact: false }),
    ).toBeVisible();
  });

  test('sees a recording beside its transcript, ready to correct', async ({ page }) => {
    await page.goto('/knowledge');
    await page.getByRole('link', { name: SNAPSHOT_RECORDING.title }).click();
    await expect(
      page.getByRole('heading', { name: SNAPSHOT_RECORDING.title, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('Ready to search')).toBeVisible();
    await expect(page.getByText('Management and Accounts')).toBeVisible();
    await expect(page.getByLabel('What was said')).toHaveValue(SNAPSHOT_RECORDING.transcript);
    await expect(page.getByRole('button', { name: 'Save transcript' })).toBeVisible();
    await expectNoAxeViolations(page);
    // The browser's own player is drawn differently as it loads the recording.
    await snap(page, 'knowledge-recording', { mask: [page.locator('audio')] });
  });
});

test.describe('as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('reads a staff recording’s transcript and cannot change it', async ({ page }) => {
    await page.goto('/knowledge');
    await page.getByRole('link', { name: READER_RECORDING.title }).click();
    await expect(
      page.getByRole('heading', { name: READER_RECORDING.title, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(READER_RECORDING.transcript)).toBeVisible();
    await expect(page.getByLabel('What was said')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save transcript' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});

test.describe('as a tele-caller of the snapshot company', () => {
  test.use(signedInAs('snapshotCaller'));

  test('never sees a management recording in the list', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page.getByRole('heading', { name: 'Knowledge', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: SNAPSHOT_RECORDING.title })).toHaveCount(0);
  });
});
