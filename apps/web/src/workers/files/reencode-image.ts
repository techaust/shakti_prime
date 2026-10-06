import sharp from 'sharp';

/** The images a file check re-encodes. */
export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const FORMATS: Record<ImageType, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * The most pixels an image may have before it is decoded: a phone photo is 12 to 50 megapixels;
 * anything larger is refused rather than unpacked into memory.
 */
export const MAX_IMAGE_PIXELS = 50_000_000;

/** The longest side kept: larger photos are scaled down, never up. */
export const MAX_IMAGE_EDGE = 4096;

export type Reencoded =
  | { ok: true; bytes: Uint8Array; contentType: ImageType }
  | { ok: false; reason: 'file_unreadable' | 'file_image_too_large' };

export function isImageType(type: string): type is ImageType {
  return Object.hasOwn(FORMATS, type);
}

/**
 * Re-encodes an upload (docs/07-security.md §8): decoded and written again in its own format, the
 * camera's orientation applied to the pixels, and everything else the file carried (location,
 * camera details, comments, embedded thumbnails, anything appended) dropped, which sharp does
 * unless told to keep metadata. The bytes must be the declared format.
 */
export async function reencodeImage(
  input: Uint8Array,
  contentType: ImageType,
  limits: { maxPixels?: number } = {},
): Promise<Reencoded> {
  let image: ReturnType<typeof sharp>;
  let format: string | undefined;
  const maxPixels = limits.maxPixels ?? MAX_IMAGE_PIXELS;
  try {
    image = sharp(input, { limitInputPixels: maxPixels, failOn: 'error' });
    const meta = await image.metadata();
    format = meta.format;
    if (meta.width * meta.height > maxPixels) {
      return { ok: false, reason: 'file_image_too_large' };
    }
  } catch (error) {
    return { ok: false, reason: tooLarge(error) ? 'file_image_too_large' : 'file_unreadable' };
  }
  if (format !== FORMATS[contentType]) return { ok: false, reason: 'file_unreadable' };
  try {
    const upright = image
      .rotate()
      .resize(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, { fit: 'inside', withoutEnlargement: true });
    const out =
      contentType === 'image/jpeg'
        ? upright.jpeg({ quality: 85, mozjpeg: true })
        : contentType === 'image/png'
          ? upright.png({ compressionLevel: 9 })
          : upright.webp({ quality: 85 });
    return { ok: true, bytes: new Uint8Array(await out.toBuffer()), contentType };
  } catch (error) {
    return { ok: false, reason: tooLarge(error) ? 'file_image_too_large' : 'file_unreadable' };
  }
}

function tooLarge(error: unknown): boolean {
  return error instanceof Error && /pixel limit/i.test(error.message);
}
