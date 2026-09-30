import { deflateSync } from 'node:zlib';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  signedInAs,
  snap,
  test,
} from './support/fixtures';

// The runner in the Linux image loads nothing native (docs/TESTING.md §5), so the logo is a PNG
// written here byte by byte rather than drawn with an image library.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A 240 by 80 logo in one colour, as a valid PNG. */
function logo(): Buffer {
  const width = 240;
  const height = 80;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0)]);
  for (let x = 0; x < width; x += 1) row.set([40, 80, 200], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test.describe('the logo and letterhead of a company', () => {
  test.use(signedInAs('executive'));

  test('an Executive uploads a logo and a letterhead, which become the current ones once checked', async ({
    page,
  }) => {
    await page.goto('/settings/companies');
    await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible();
    await dataGrid(page, 'Companies')
      .getByRole('button', { name: 'Logo and letterhead' })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Logo and letterhead of/ })).toBeVisible();
    await expectNoAxeViolations(page);

    const inputs = dialog.locator('input[type="file"]');
    const saved = dialog.getByText('Saved. Documents from this company print it from now on.');
    await inputs.nth(0).setInputFiles({
      name: 'Shakti Supreme logo.png',
      mimeType: 'image/png',
      buffer: logo(),
    });
    // The checks run in the app itself on this machine (no queue), then the uploader says so.
    await expect(saved).toHaveCount(1, { timeout: 45_000 });
    await inputs.nth(1).setInputFiles({
      name: 'Shakti Supreme letterhead.png',
      mimeType: 'image/png',
      buffer: logo(),
    });
    await expect(saved).toHaveCount(2, { timeout: 45_000 });
    await expect(dialog.getByText('Current file: Shakti Supreme logo.png')).toBeVisible();
    await expect(dialog.getByText('Current file: Shakti Supreme letterhead.png')).toBeVisible();
    await expectNoAxeViolations(page);
    // Both files are this journey's own, so the dialog looks the same on every run.
    await snap(page, 'branding-dialog');
  });

  test('a PDF on the logo field is refused before anything is sent', async ({ page }) => {
    await page.goto('/settings/companies');
    await dataGrid(page, 'Companies')
      .getByRole('button', { name: 'Logo and letterhead' })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    const uploads: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' || request.url().includes('/files/')) {
        uploads.push(request.url());
      }
    });
    await dialog
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: 'Logo.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\n%%EOF\n'),
      });
    await expect(
      dialog.getByText('This kind of file cannot be used here. Choose a JPEG, PNG or WebP file.'),
    ).toBeVisible();
    expect(uploads).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
