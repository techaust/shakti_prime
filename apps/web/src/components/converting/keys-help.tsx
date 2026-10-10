'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Key } from '../calling/calling-parts';

const KEYS = [
  'search',
  'move',
  'enter',
  'next',
  'log',
  'callback',
  'sizing',
  'quote',
  'dial',
  'outcome',
  'help',
] as const;

/**
 * The keys of the workspace, in a panel the converter opens with `?` (or the button) and closes
 * the same way. A disclosure, so it works from the keyboard and a screen reader names its state.
 */
export function KeysHelp({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  const t = useTranslations('converting.keys');
  const id = useId();
  return (
    <details
      open={open}
      onToggle={(e) => {
        onToggle(e.currentTarget.open);
      }}
      className="border-border bg-surface rounded-lg border p-4"
    >
      <summary className="text-h3 cursor-pointer">{t('title')}</summary>
      <p id={`${id}-hint`} className="text-text-muted mt-2 text-sm">
        {t('hint')}
      </p>
      <dl aria-describedby={`${id}-hint`} className="mt-3 flex flex-col gap-2 text-sm">
        {KEYS.map((name) => (
          <div key={name} className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">{t(`what.${name}`)}</dt>
            <dd>
              <Key>{t(name)}</Key>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
