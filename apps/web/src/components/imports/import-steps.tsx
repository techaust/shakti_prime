'use client';

import type { ImportJobState } from '@shakti/contracts';
import { cn } from '@shakti/ui';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IMPORT_STEPS, stepStatus } from '../../screens/import-wizard';

/**
 * The four steps of an import, with the one the job waits at marked. Before a job exists (the
 * upload form) the first step is current. On a phone only the current step keeps its name on
 * screen; the others keep theirs for screen readers.
 */
export function ImportSteps({ state }: { state: ImportJobState | undefined }) {
  const t = useTranslations('imports.steps');
  return (
    <nav aria-label={t('label')}>
      <ol className="flex items-center gap-2 sm:gap-3">
        {IMPORT_STEPS.map((step, index) => {
          const status =
            state === undefined ? (index === 0 ? 'current' : 'next') : stepStatus(step, state);
          return (
            <li
              key={step}
              aria-current={status === 'current' ? 'step' : undefined}
              className="flex min-w-0 items-center gap-2 sm:gap-3"
            >
              {index === 0 ? null : (
                <span aria-hidden className="bg-border h-px w-4 shrink-0 sm:w-6" />
              )}
              <span
                aria-hidden
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-[510] tabular-nums',
                  status === 'done' && 'bg-success-soft text-success',
                  status === 'current' && 'bg-accent text-accent-fg',
                  status === 'next' && 'bg-surface-2 text-text-muted',
                )}
              >
                {status === 'done' ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  'truncate text-sm',
                  status === 'current' ? 'text-text font-[510]' : 'text-text-muted max-sm:sr-only',
                )}
              >
                {t(step)}
                <span className="sr-only">
                  {' '}
                  {t(`status.${status}`)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
