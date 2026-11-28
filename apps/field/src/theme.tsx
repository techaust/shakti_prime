import { resolve, type Theme } from '@shakti/tokens';
import { vars } from 'nativewind';
import type { ReactNode } from 'react';
import { useColorScheme, View } from 'react-native';

/**
 * The token colours for the phone's light or dark setting (docs/08-design-system.md §2), set as the
 * CSS variables every class name of tailwind.config.js reads. Phones in daylight get the high
 * contrast variant in a later slice, with the person's own setting.
 */
export function themeVariables(theme: Theme): Record<string, string> {
  return Object.fromEntries(
    Object.entries(resolve(theme)).map(([name, value]) => [`--${name}`, value]),
  );
}

const VARIABLES = { light: vars(themeVariables('light')), dark: vars(themeVariables('dark')) };

export function ThemeRoot({ children }: { children: ReactNode }) {
  const theme: Theme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <View style={VARIABLES[theme]} className="flex-1 bg-bg">
      {children}
    </View>
  );
}
