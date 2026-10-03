'use client';

import { referenceFromDigest } from '../reference';
import { GLOBAL_ERROR_COPY as t } from './global-error-copy';
import './globals.css';

/**
 * The last resort when the root layout itself fails (AUDIT M38). It renders its own document and
 * takes its few sentences from `global-error-copy.ts`, because the layout that provides
 * translations is what failed, and the whole catalogue would ship with every page.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
          <h1 className="text-h1">{t.title}</h1>
          <p className="text-text-muted">{t.body}</p>
          {error.digest === undefined ? null : (
            <p className="text-text-muted tabular-nums">
              {t.reference.replace('{reference}', referenceFromDigest(error.digest))}
            </p>
          )}
          <a href="/home" className="text-accent-text underline underline-offset-4">
            {t.home}
          </a>
        </main>
      </body>
    </html>
  );
}
