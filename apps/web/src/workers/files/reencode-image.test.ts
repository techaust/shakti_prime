import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS, reencodeImage } from './reencode-image';

async function photo(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 20 } } })
    .jpeg()
    .withExif({ IFD0: { ImageDescription: 'Farm gate north', Make: 'PhoneCo' } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe('image re-encoding', () => {
  it('applies the camera orientation and drops everything the file carried', async () => {
    const input = await photo(40, 20);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await reencodeImage(input, 'image/jpeg');
    if (!out.ok) throw new Error(out.reason);
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.format).toBe('jpeg');
    // Orientation 6 turns the picture a quarter: 40 by 20 becomes 20 by 40.
    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(Buffer.from(out.bytes).toString('latin1')).not.toContain('Farm gate');
  });

  it('keeps PNG and WebP in their own format', async () => {
    const base = sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    });
    for (const [type, format] of [
      ['image/png', 'png'],
      ['image/webp', 'webp'],
    ] as const) {
      const input = await base.clone().toFormat(format).toBuffer();
      const out = await reencodeImage(input, type);
      if (!out.ok) throw new Error(out.reason);
      expect((await sharp(Buffer.from(out.bytes)).metadata()).format).toBe(format);
    }
  });

  it('drops bytes appended after the picture', async () => {
    const input = Buffer.concat([await photo(8, 8), Buffer.from('<script>hidden</script>')]);
    const out = await reencodeImage(input, 'image/jpeg');
    if (!out.ok) throw new Error(out.reason);
    expect(Buffer.from(out.bytes).toString('latin1')).not.toContain('<script>');
  });

  it('scales a very large photo down to the longest side kept', async () => {
    const input = await sharp({
      create: { width: MAX_IMAGE_EDGE + 100, height: 10, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const out = await reencodeImage(input, 'image/png');
    if (!out.ok) throw new Error(out.reason);
    expect((await sharp(Buffer.from(out.bytes)).metadata()).width).toBe(MAX_IMAGE_EDGE);
  });

  it('refuses an image over the pixel limit', async () => {
    expect(MAX_IMAGE_PIXELS).toBe(50_000_000);
    const input = await photo(20, 20);
    expect(await reencodeImage(input, 'image/jpeg', { maxPixels: 399 })).toEqual({
      ok: false,
      reason: 'file_image_too_large',
    });
    expect((await reencodeImage(input, 'image/jpeg', { maxPixels: 400 })).ok).toBe(true);
  });

  it('refuses bytes that are not the declared format, or not an image at all', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000000' } })
      .png()
      .toBuffer();
    expect(await reencodeImage(png, 'image/jpeg')).toEqual({
      ok: false,
      reason: 'file_unreadable',
    });
    expect(await reencodeImage(Buffer.from('%PDF-1.7'), 'image/png')).toEqual({
      ok: false,
      reason: 'file_unreadable',
    });
    const cut = (await photo(64, 64)).subarray(0, 200);
    expect((await reencodeImage(cut, 'image/jpeg')).ok).toBe(false);
  });
});
