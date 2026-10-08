import { UPLOAD_LIMITS } from '@shakti/domain';
import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getQuote } from '../../../../../actions/quotes';
import { QuoteScreen } from '../../../../../components/quotes/quote-screen';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../../screens/access';
import { firstFailure } from '../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface Params {
  entityId: string;
  quoteId: string;
}

/** The limits of a signed copy, for the uploader to check before it sends a byte. */
function signedCopyLimit() {
  const found = UPLOAD_LIMITS.signed_quote;
  if (found === undefined) throw new Error('no upload limits for signed_quote');
  return { contentTypes: [...found.contentTypes], maxBytes: found.maxBytes };
}

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('quotes'), (await getTranslations('quotes'))('title'));
}

/**
 * One quote (docs/03-roadmap-appendix/phase1.md §7.3): its lines and totals, its document, and sending,
 * re-quoting or withdrawing it. A quote the caller may not read, or an address that names none,
 * shows the not-found screen.
 */
export default async function QuotePage({ params }: { params: Promise<Params> }) {
  const { access, can } = await screenAccess(navRequires('quotes'));
  const { entityId: rawEntityId, quoteId } = await params;
  const entityId = Number(rawEntityId);
  if (!Number.isInteger(entityId) || entityId < 1 || entityId > 32_767 || !UUID.test(quoteId)) {
    notFound();
  }
  const quote = await getQuote({ entityId, quoteId });
  if (!quote.ok && ['quote_missing', 'forbidden'].includes(quote.error)) notFound();
  const t = await getTranslations('quotes');
  const print = await getTranslations('print');
  const stateKey = quote.ok
    ? (`states.${quote.data.placeOfSupplyState}` as 'states.08')
    : undefined;
  return quote.ok ? (
    <QuoteScreen
      // A fresh screen for each quote, so a re-quote opens with its own state.
      key={quote.data.id}
      initial={quote.data}
      company={companyNames(access)[quote.data.entityId] ?? ''}
      // For a caller who may record an acceptance once the quote is sent, whatever it is now.
      {...(can('sales.quote.send', 'own') && can('sales.order.create', 'own')
        ? { acceptLimit: signedCopyLimit() }
        : {})}
      placeOfSupply={
        stateKey !== undefined && print.has(stateKey)
          ? print('quote.placeOfSupplyState', {
              state: print(stateKey),
              code: quote.data.placeOfSupplyState,
            })
          : quote.data.placeOfSupplyState
      }
    />
  ) : (
    <Page
      title={t('title')}
      width="detail"
      actions={
        <Button asChild variant="secondary">
          <Link href="/quotes">{t('page.back')}</Link>
        </Button>
      }
    >
      <FailureMessage failure={firstFailure(quote)} />
    </Page>
  );
}
