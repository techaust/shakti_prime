/**
 * The Tailwind classes that step around the design tokens (docs/08-design-system.md §2 to §4, AGENTS.md §11):
 * an arbitrary value in brackets for a colour, a font weight or size, a line height, a radius, a
 * blur or a space (padding, margin, gap, width, height, position), and a weight outside the three
 * of docs/08-design-system.md §3. The source-rule tests of this package and of the web app run it over their
 * own files, each with its short list of named exceptions.
 */

/** Utility families whose value is a colour, a type size or weight, a radius, a blur or a space. */
const FAMILIES = [
  // colours, and the text size, which shares `text-`
  'bg',
  'text',
  'border(?:-[trblxyse])?',
  'ring(?:-offset)?',
  'outline',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
  'decoration',
  'caret',
  'accent',
  'divide(?:-[xy])?',
  'shadow',
  'placeholder',
  // type
  'font',
  'leading',
  // radius and blur
  'rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?',
  'blur',
  'backdrop-blur',
  // space and size
  'p[trblxyse]?',
  'm[trblxyse]?',
  'gap(?:-[xy])?',
  'space-[xy]',
  'w',
  'h',
  'size',
  'min-w',
  'min-h',
  'max-w',
  'max-h',
  'inset(?:-[xy])?',
  'top',
  'right',
  'bottom',
  'left',
  'start',
  'end',
  'translate-[xy]',
  'basis',
  'indent',
  'scroll-[mp][trblxyse]?',
];

/**
 * One class: at the start, after a space, a quote or a variant's colon, an optional minus, a
 * family, then a bracketed value. `grid-cols-[…]` or `data-[state=open]:` are not in a family.
 */
const ARBITRARY = new RegExp(`(?<=^|[\\s"'\`:])-?(?:${FAMILIES.join('|')})-\\[[^\\]\\s]+\\]`, 'g');

/** Tailwind's weights that docs/08-design-system.md §3 does not use; the tokens clear them from the theme. */
const OFF_SCALE_WEIGHT = /(?<=^|[\s"'`:])font-(?:thin|extralight|light|bold|extrabold|black)\b/g;

/** Every class in `source` that bypasses the tokens, in the order they appear. */
export function tokenBypasses(source: string): string[] {
  return [...(source.match(ARBITRARY) ?? []), ...(source.match(OFF_SCALE_WEIGHT) ?? [])];
}
