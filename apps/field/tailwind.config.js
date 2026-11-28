// The field app's Tailwind theme, read from @shakti/tokens (docs/08-design-system.md §2–§5): every
// colour is a CSS variable whose value the app sets from the tokens for the phone's light or dark
// setting (src/theme.tsx), and the spacing, radii and type sizes are the tokens' own numbers. No
// colour is written here. Tailwind (and NativeWind through it) loads this file with jiti, which
// reads the import syntax and the tokens' TypeScript.
import { aliases, colors, scale } from '@shakti/tokens';
import nativewind from 'nativewind/preset';

const colorNames = [...Object.keys(colors), ...Object.keys(aliases)];
const px = (record) =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, `${String(value)}px`]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [nativewind],
  darkMode: 'media',
  theme: {
    colors: Object.fromEntries(colorNames.map((name) => [name, `var(--${name})`])),
    spacing: { 0: '0px', ...px(scale.space) },
    borderRadius: { none: '0px', ...px(scale.radius), full: '9999px' },
    fontSize: Object.fromEntries(
      Object.entries(scale.font).map(([name, f]) => [
        name,
        [`${String(f.size)}px`, { lineHeight: `${String(f.line)}px` }],
      ]),
    ),
    extend: {
      minHeight: { control: `${String(scale.control.phone)}px` },
    },
  },
};
