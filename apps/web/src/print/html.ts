// A tiny escaping HTML builder for print templates. Every interpolated value is escaped
// unless it was produced by `html` itself or wrapped in `trusted()` (markup this module
// generates, such as the QR code SVG).

const TRUSTED = Symbol('trusted-html');

export interface Html {
  readonly [TRUSTED]: true;
  readonly value: string;
}

export function trusted(value: string): Html {
  return { [TRUSTED]: true, value };
}

function isHtml(value: unknown): value is Html {
  return typeof value === 'object' && value !== null && TRUSTED in value;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

type Part = string | number | Html | readonly Part[] | null | undefined | false;

function render(part: Part): string {
  if (part === null || part === undefined || part === false) return '';
  if (typeof part === 'string') return escapeHtml(part);
  if (typeof part === 'number') return escapeHtml(String(part));
  if (isHtml(part)) return part.value;
  return part.map(render).join('');
}

/** Tagged template: `html\`<td>${name}</td>\`` escapes `name`. */
export function html(strings: TemplateStringsArray, ...values: Part[]): Html {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? '');
  });
  return trusted(out);
}
