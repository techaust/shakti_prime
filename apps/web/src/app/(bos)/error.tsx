'use client';

import { Button } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Page } from '../../components/shell/page';
import { referenceFromDigest } from '../../reference';

/**
 * A BOS screen that fails unexpectedly, shown inside the app shell: the sidebar, company switcher
 * and search stay, so one failed list does not take the rest of the app with it. The same plain
 * sentence and reference as the root error screen (AUDIT M38), a retry that reads the screen
 * afresh from the server, and a way home. Nothing technical reaches the page.
 */
export default function BosErrorScreen({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Reads the screen again from the server, then clears the error (Next.js 16). */
  retry?: () => void;
}) {
  const t = useTranslations('errorPage');
  const app = useTranslations('app');
  return (
    <Page title={t('title')} width="form">
      <div role="alert" className="flex flex-col gap-2">
        <p className="text-text-muted">{t('body')}</p>
        {error.digest === undefined ? null : (
          <p className="text-text-muted tabular-nums">
            {app('reference', { reference: referenceFromDigest(error.digest) })}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={retry ?? reset}>{t('retry')}</Button>
        <Button variant="secondary" asChild>
          <Link href="/home">{t('home')}</Link>
        </Button>
      </div>
    </Page>
  );
}
