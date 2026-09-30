'use client';

import { Button, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { recheckFiles } from '../../actions/files';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

/**
 * Admin › Integration health: the files still waiting for their checks after ten minutes, and
 * "Check files again", which sends them back to their checks (`files.file.recheck`).
 */
export function FilesRecheck({ initialCount }: { initialCount: number }) {
  const t = useTranslations('integrations.files');
  const [count, setCount] = useState(initialCount);
  const { run, pending, failure } = useCommand(recheckFiles);
  return (
    <section aria-labelledby="integrations-files" className="flex flex-col gap-3">
      <h2 id="integrations-files" className="text-h3">
        {t('heading')}
      </h2>
      <p className="text-text-muted">{t('intro')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          pending={pending}
          onClick={() => {
            run({}, (done) => {
              setCount(0);
              toast.success(t('done', { count: done.requeued }));
            });
          }}
        >
          {t('recheck')}
        </Button>
        {/* The count changes with every upload, so screenshots leave it out. */}
        <p className="text-text-muted" role="status" data-dynamic>
          {t('waiting', { count })}
        </p>
      </div>
      <FailureMessage failure={failure} />
    </section>
  );
}
