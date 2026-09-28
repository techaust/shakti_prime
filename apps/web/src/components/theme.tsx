'use client';

import { ThemeSchema, type Theme } from '@shakti/contracts';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState, useTransition } from 'react';
import { saveTheme } from '../actions/profile';
import { settle } from './screens/settle';
import type { ErrorKey } from '../i18n/types';
import { contrastCookie, HIGH_CONTRAST, themeCookie } from '../theme';

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
  /**
   * Called with the reason, and the support reference of an unexpected failure, when the profile
   * refuses the choice (the profile menu shows a toast).
   */
  onError?: (key: ErrorKey, reference?: string) => void,
): {
  chosen: Theme;
  choose: (theme: Theme) => void;
  error: ErrorKey | undefined;
  reference: string | undefined;
} {
  const errors = useTranslations('errors');
  const { setTheme } = useTheme();
  const [chosen, setChosen] = useState<Theme>(saved);
  const [error, setError] = useState<ErrorKey | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const [, startTransition] = useTransition();

  function choose(theme: Theme) {
    const before = chosen;
    setChosen(theme);
    setTheme(theme);
    rememberOnThisDevice(theme);
    setError(undefined);
    setReference(undefined);
    // One idempotency key per change: a repeated delivery of this change is kept once, and the
    // next change is a new one.
    const idempotencyKey = crypto.randomUUID();
    startTransition(async () => {
      const result = await settle(() => saveTheme({ theme }, idempotencyKey));
      if (result.ok) return;
      setChosen(before);
      setTheme(before);
      rememberOnThisDevice(before);
      const known: ErrorKey = errors.has(result.error) ? result.error : 'internal';
      setError(known);
      setReference(result.reference);
      onError?.(known, result.reference);
    });
  }

  return { chosen, choose, error, reference };
}

/** System, Light or Dark (DESIGN.md §7). The screen switches at once; the profile keeps it. */
export function ThemeSwitch({ saved }: { saved: Theme }) {
  const t = useTranslations('theme');
  const errors = useTranslations('errors');
  const app = useTranslations('app');
  const { chosen, choose, error, reference } = useThemeChoice(saved);

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
          {reference !== undefined && ` ${app('reference', { reference })}`}
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

/**
 * Higher contrast (DESIGN.md §2.1): darker text and stronger outlines for phones used outdoors.
 * It switches at once and is kept on this device; a browser that blocks cookies keeps it for
 * this page only.
 */
export function ContrastSwitch({ saved }: { saved: boolean }) {
  const t = useTranslations('theme');
  const [high, setHigh] = useState(saved);

  function choose(next: boolean) {
    setHigh(next);
    const root = document.documentElement;
    if (next) root.dataset.contrast = HIGH_CONTRAST;
    else delete root.dataset.contrast;
    try {
      document.cookie = contrastCookie(next, window.location.protocol === 'https:');
    } catch {
      // the choice lasts until the page is reloaded
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="high-contrast" className="font-[510]">
          {t('highContrast')}
        </label>
        <p id="high-contrast-hint" className="text-text-muted text-sm">
          {t('highContrastHint')}
        </p>
      </div>
      <button
        id="high-contrast"
        type="button"
        role="switch"
        aria-checked={high}
        aria-describedby="high-contrast-hint"
        onClick={() => {
          choose(!high);
        }}
        className="bg-surface-3 border-border-strong aria-checked:bg-accent aria-checked:border-accent focus-visible:outline-focus relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-(--motion-fast) ease-out focus-visible:outline-2 focus-visible:outline-offset-2 before:absolute before:-inset-2.5"
      >
        <span
          aria-hidden
          className={`bg-surface border-border-strong shadow-1 inline-block size-5 rounded-full border transition-transform duration-(--motion-fast) ease-out ${high ? 'translate-x-5' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  );
}
