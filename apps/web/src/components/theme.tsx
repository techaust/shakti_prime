'use client';

import { ThemeSchema, type Theme } from '@shakti/contracts';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState, useTransition } from 'react';
import { saveTheme } from '../actions/profile';
import type { ErrorKey } from '../i18n/types';
import { themeCookie } from '../theme';

const THEMES = ThemeSchema.options;

function rememberOnThisDevice(theme: Theme | undefined): void {
  document.cookie = themeCookie(theme, window.location.protocol === 'https:');
}

/**
 * Follows the theme saved on the profile, so a choice made on one device reaches the others.
 * Runs when the page loads and whenever the saved value changes; a choice made on this page
 * wins until the server confirms it.
 */
export function ThemeSync({ saved }: { saved: Theme }) {
  const { setTheme } = useTheme();
  // next-themes hands out a new setTheme whenever the theme changes, so the effect re-runs on
  // every switch; apply each saved value once, or it would undo the choice just made.
  const applied = useRef<Theme | undefined>(undefined);
  useEffect(() => {
    if (applied.current === saved) return;
    applied.current = saved;
    setTheme(saved);
    rememberOnThisDevice(saved);
  }, [saved, setTheme]);
  return null;
}

/**
 * The theme choice behind the switch on the profile screen and the profile menu: the screen
 * switches at once, the profile keeps it, and a refused save puts the previous choice back and
 * names the reason (a catalogue key under `errors`).
 */
export function useThemeChoice(
  saved: Theme,
  /** Called with the reason when the profile refuses the choice (the profile menu shows a toast). */
  onError?: (key: ErrorKey) => void,
): {
  chosen: Theme;
  choose: (theme: Theme) => void;
  error: ErrorKey | undefined;
} {
  const errors = useTranslations('errors');
  const { setTheme } = useTheme();
  const [chosen, setChosen] = useState<Theme>(saved);
  const [error, setError] = useState<ErrorKey | undefined>();
  const [, startTransition] = useTransition();

  function choose(theme: Theme) {
    const before = chosen;
    setChosen(theme);
    setTheme(theme);
    rememberOnThisDevice(theme);
    setError(undefined);
    startTransition(async () => {
      const result = await saveTheme({ theme });
      if (result.error === undefined) return;
      setChosen(before);
      setTheme(before);
      rememberOnThisDevice(before);
      const key = result.error as ErrorKey;
      const known: ErrorKey = errors.has(key) ? key : 'internal';
      setError(known);
      onError?.(known);
    });
  }

  return { chosen, choose, error };
}

/** System, Light or Dark (DESIGN.md §7). The screen switches at once; the profile keeps it. */
export function ThemeSwitch({ saved }: { saved: Theme }) {
  const t = useTranslations('theme');
  const errors = useTranslations('errors');
  const { chosen, choose, error } = useThemeChoice(saved);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-text-muted mb-2 text-sm">{t('label')}</legend>
      <div className="bg-surface-2 border-border inline-flex self-start rounded-[var(--radius-md)] border p-0.5">
        {THEMES.map((theme) => (
          <label
            key={theme}
            className="text-text-muted has-[:checked]:bg-surface has-[:checked]:text-text has-[:checked]:shadow-1 has-[:focus-visible]:outline-focus inline-flex h-8 cursor-pointer items-center rounded-[var(--radius-sm)] px-3 font-[510] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 max-md:h-11"
          >
            <input
              type="radio"
              name="theme"
              value={theme}
              checked={chosen === theme}
              onChange={() => {
                choose(theme);
              }}
              className="sr-only"
            />
            {t(theme)}
          </label>
        ))}
      </div>
      {error !== undefined && (
        <p role="alert" className="text-danger text-sm">
          {errors(error)}
        </p>
      )}
    </fieldset>
  );
}

/** Before sign-out: the next person at a shared desk starts from the device's own setting. */
export function useForgetThemeOnThisDevice(): () => void {
  const { setTheme } = useTheme();
  return () => {
    setTheme('system');
    rememberOnThisDevice(undefined);
  };
}
