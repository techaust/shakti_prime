// WCAG 2.x relative luminance and contrast ratio, used by the CI contrast check (DESIGN.md §2.4).

function channel(hex: string): number {
  const c = Number.parseInt(hex, 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const [, r, g, b] = m;
  return 0.2126 * channel(r ?? '00') + 0.7152 * channel(g ?? '00') + 0.0722 * channel(b ?? '00');
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}
