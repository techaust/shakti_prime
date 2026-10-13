'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '../components/form-button';
import { referenceFromDigest } from '../reference';

/**
 * Any screen that fails unexpectedly (AUDIT M38): the plain sentence, the reference support can
 * look up (logged by `onRequestError` from the same digest), a retry and a way home. The retry
 * reads the screen afresh from the server (`retry`), since `reset` alone renders the same failed
 * answer again and cannot recover once an outage has ended.
 */
export default function ErrorScreen({
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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-text-muted">{t('body')}</p>
        {error.digest === undefined ? null : (
          <p className="text-text-muted tabular-nums">
            {app('reference', { reference: referenceFromDigest(error.digest) })}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={retry ?? reset}>
          {t('retry')}
        </Button>
        <Link
          href="/home"
          className="text-accent-text inline-flex min-h-9 items-center underline-offset-4 hover:underline max-md:min-h-11"
        >
          {t('home')}
        </Link>
      </div>
    </main>
  );
}
