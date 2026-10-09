'use client';

import type { QuoteBuilderDto, QuoteDto } from '@shakti/contracts';
import { Button, Skeleton } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadQuoteBuilder } from '../../actions/quotes';
import { quoteHref } from '../../screens/quotes';
import { QuoteBuilder } from '../quotes/quote-builder';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';

/**
 * The quote panel: the quote builder of the lead (the same form, the same command as `/quotes/new`)
 * opened in place. A quote made stays on this screen, with a link to its page.
 */
export function QuotePanel({
  entityId,
  opportunityId,
  onMade,
}: {
  entityId: number;
  opportunityId: string;
  onMade: () => void;
}) {
  const t = useTranslations('converting.quote');
  const { load, pending, failure } = useQuery<QuoteBuilderDto>();
  const [builder, setBuilder] = useState<QuoteBuilderDto | undefined>();
  const [made, setMade] = useState<QuoteDto | undefined>();
  // A new form after each quote made, so the lines start empty again.
  const [round, setRound] = useState(0);

  useEffect(() => {
    load(() => loadQuoteBuilder({ entityId, opportunityId }), setBuilder);
  }, [load, entityId, opportunityId]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {made === undefined ? null : (
        <div
          role="status"
          className="border-border bg-surface-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
        >
          <span>{t('made', { number: made.quoteNo })}</span>
          <span className="flex flex-wrap items-center gap-2">
            <Button asChild variant="secondary">
              <Link href={quoteHref(made.entityId, made.id)}>{t('open')}</Link>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setMade(undefined);
                setRound((n) => n + 1);
              }}
            >
              {t('another')}
            </Button>
          </span>
        </div>
      )}
      {builder === undefined ? (
        failure === undefined || pending ? (
          <div aria-busy="true" aria-label={t('loading')} className="flex flex-col gap-3">
            <Skeleton className="h-control w-full" />
            <Skeleton className="h-control w-2/3" />
          </div>
        ) : (
          <FailureMessage failure={failure} />
        )
      ) : made !== undefined ? null : (
        <QuoteBuilder
          key={round}
          builder={builder}
          onCreated={(quote) => {
            setMade(quote);
            onMade();
          }}
        />
      )}
    </div>
  );
}
