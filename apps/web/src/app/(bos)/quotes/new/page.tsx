import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadQuoteBuilder } from '../../../../actions/quotes';
import { QuoteBuilder } from '../../../../components/quotes/quote-builder';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { companyParam, customerHref } from '../../../../screens/customers';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('quotes'), (await getTranslations('quotes'))('builder.pageTitle'));
}

/**
 * The quote builder of one lead (docs/design/phase1.md §7.3), opened from the lead on Account 360:
 * `?company=<company>&lead=<lead>`. A lead the caller may not read, or an address that names none,
 * shows the not-found screen.
 */
export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await screenAccess(navRequires('quotes'));
  const query = await searchParams;
  const entityId = companyParam(query.company);
  const lead = Array.isArray(query.lead) ? query.lead[0] : query.lead;
  if (entityId === undefined || lead === undefined || !UUID.test(lead)) notFound();
  const t = await getTranslations('quotes');
  const builder = await loadQuoteBuilder({ entityId, opportunityId: lead });
  if (!builder.ok && ['lead_missing', 'forbidden'].includes(builder.error)) notFound();
  return builder.ok ? (
    <Page
      title={t('builder.for', { name: builder.data.customerName })}
      description={t('builder.intro')}
      width="detail"
      actions={
        <Button asChild variant="secondary">
          <Link href={customerHref(builder.data.accountId, builder.data.entityId)}>
            {t('builder.back')}
          </Link>
        </Button>
      }
    >
      <QuoteBuilder builder={builder.data} />
    </Page>
  ) : (
    <Page title={t('builder.pageTitle')} width="detail">
      <FailureMessage failure={firstFailure(builder)} />
    </Page>
  );
}
