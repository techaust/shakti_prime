// A logo and a letterhead strip for the print tests and the template snapshots: plain shapes in
// the light theme's colours, drawn by sharp from SVG, so they render the same on every machine
// (no text, so no system font is involved). Never printed on a document.
import sharp from 'sharp';
import type { PrintImage } from '../company';
import { lightColor } from '../styles';

async function png(svg: string): Promise<PrintImage> {
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  return { contentType: 'image/png', base64: bytes.toString('base64') };
}

export async function spikeImages(): Promise<{ logo: PrintImage; letterhead: PrintImage }> {
  const accent = lightColor('accent');
  const surface = lightColor('surface-2');
  const border = lightColor('border-strong');
  const [logo, letterhead] = await Promise.all([
    png(
      `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" rx="24" fill="${surface}"/><circle cx="80" cy="80" r="48" fill="${accent}"/></svg>`,
    ),
    png(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="200"><rect width="1800" height="200" fill="${surface}"/><rect y="168" width="1800" height="32" fill="${accent}"/><rect x="40" y="40" width="96" height="96" rx="16" fill="${border}"/></svg>`,
    ),
  ]);
  return { logo, letterhead };
}
