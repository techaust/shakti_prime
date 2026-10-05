'use client';

import type { QuoteDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  StatusBadge,
  Textarea,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { getQuote, requoteQuote, sendQuote, withdrawQuote } from '../../actions/quotes';
import { customerHref } from '../../screens/customers';
import { formatDate, formatDateTime } from '../../screens/format';
import { QUOTE_STATE_TONE, quoteHref } from '../../screens/quotes';
import { useOpenFile } from '../files/use-open-file';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { settle } from '../screens/settle';
import { useCommand } from '../screens/use-command';
import { Page } from '../shell/page';
import { QuoteLinesTable, QuoteTotals } from './quote-tables';

/** How often the page asks whether the document is ready, and how many times before it says so. */
const PDF_POLL_MS = 3_000;
const PDF_POLL_TRIES = 20;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-text-muted text-sm">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/**
 * The quote page (docs/design/phase1.md §7.3): the quote as it was made, its document once the
 * render worker has printed it (the page asks again every few seconds until then), and the moves
 * the caller may make: mark it as sent, re-quote it at today's prices, or withdraw it.
 */
export function QuoteScreen({
  initial,
  company,
  placeOfSupply,
}: {
  initial: QuoteDto;
  company: string;
  /** The state of supply in words, as the quotation prints it. */
  placeOfSupply: string;
}) {
  const t = useTranslations('quotes');
  const router = useRouter();
  const [quote, setQuote] = useState(initial);
  const [tries, setTries] = useState(0);
  const [withdrawing, setWithdrawing] = useState(false);
  const send = useCommand(sendQuote);
  const requote = useCommand(requoteQuote);
  const pdf = useOpenFile();

  // Until the document is attached, read the quote again every few seconds.
  const waiting = quote.pdfFileId === null && quote.state === 'draft';
  useEffect(() => {
    if (!waiting || tries >= PDF_POLL_TRIES) return;
    let current = true;
    const timer = setTimeout(() => {
      void settle(() => getQuote({ entityId: quote.entityId, quoteId: quote.id })).then(
        (result) => {
          if (!current) return;
          if (result.ok) setQuote(result.data);
          setTries((n) => n + 1);
        },
      );
    }, PDF_POLL_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [waiting, tries, quote.entityId, quote.id]);

  const failure = send.failure ?? requote.failure ?? pdf.failure;
  return (
    <Page
      width="detail"
      title={quote.quoteNo}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={QUOTE_STATE_TONE[quote.state]}>
            {t(`state.${quote.state}`)}
          </StatusBadge>
          <Link
            href={customerHref(quote.accountId, quote.entityId)}
            className="text-accent-text hover:underline"
          >
            {quote.customerName}
          </Link>
        </span>
      }
      actions={
        <>
          <Button asChild variant="secondary">
            <Link href="/quotes">{t('page.back')}</Link>
          </Button>
          {quote.canWithdraw ? (
            <Button
              variant="secondary"
              onClick={() => {
                setWithdrawing(true);
              }}
            >
              {t('page.withdraw')}
            </Button>
          ) : null}
          {quote.canRequote ? (
            <Button
              variant={quote.state === 'expired' ? 'primary' : 'secondary'}
              pending={requote.pending}
              onClick={() => {
                requote.run({ entityId: quote.entityId, quoteId: quote.id }, (next) => {
                  toast.success(t('page.requoted', { number: next.quoteNo }));
                  router.push(quoteHref(next.entityId, next.id));
                });
              }}
            >
              {t('page.requote')}
            </Button>
          ) : null}
          {quote.canSend ? (
            <Button
              pending={send.pending}
              onClick={() => {
                send.run({ entityId: quote.entityId, quoteId: quote.id }, (sent) => {
                  setQuote(sent);
                  toast.success(t('page.sent'));
                });
              }}
            >
              {t('page.send')}
            </Button>
          ) : null}
        </>
      }
    >
      <FailureMessage failure={failure} />
      {quote.state === 'expired' ? (
        <p role="note" className="text-text-muted">
          {t('page.expiredNote')}
        </p>
      ) : null}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Detail label={t('columns.company')}>{company}</Detail>
        <Detail label={t('page.madeOn')}>
          <time dateTime={quote.createdAt}>{formatDateTime(quote.createdAt)}</time>
        </Detail>
        <Detail label={t('page.madeBy')}>{quote.createdByName ?? ''}</Detail>
        <Detail label={t('page.validUntil')}>
          <time dateTime={quote.validUntil}>{formatDate(quote.validUntil)}</time>
        </Detail>
        <Detail label={t('page.tier')}>{quote.tierName}</Detail>
        <Detail label={t('page.placeOfSupply')}>{placeOfSupply}</Detail>
        <Detail label={t('page.scheme')}>{t(`builder.schemes.${quote.scheme}`)}</Detail>
        {quote.supersedesId === null ? null : (
          <Detail label={t('page.replaces')}>
            <Link
              href={quoteHref(quote.entityId, quote.supersedesId)}
              className="text-accent-text hover:underline"
            >
              {quote.supersedesNo ?? ''}
            </Link>
          </Detail>
        )}
        {quote.supersededById === null ? null : (
          <Detail label={t('page.replacedBy')}>
            <Link
              href={quoteHref(quote.entityId, quote.supersededById)}
              className="text-accent-text hover:underline"
            >
              {quote.supersededByNo ?? ''}
            </Link>
          </Detail>
        )}
        {quote.withdrawnReason === null ? null : (
          <Detail label={t('page.withdrawnBecause')}>{quote.withdrawnReason}</Detail>
        )}
      </dl>

      <section aria-labelledby="quote-document" className="flex flex-col gap-2">
        <h2 id="quote-document" className="text-h3">
          {t('page.pdfHeading')}
        </h2>
        {quote.pdfFileId !== null ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="status">{t('page.pdfReady')}</p>
            <Button
              variant="secondary"
              pending={pdf.opening}
              onClick={() => {
                if (quote.pdfFileId !== null) pdf.open(quote.pdfFileId);
              }}
            >
              {t('page.open')}
            </Button>
          </div>
        ) : waiting ? (
          <p role="status" className="text-text-muted">
            {tries >= PDF_POLL_TRIES ? t('page.pdfLate') : t('page.pdfWaiting')}
          </p>
        ) : null}
        {quote.canSend ? <p className="text-text-muted text-sm">{t('page.sendIntro')}</p> : null}
        {quote.canRequote ? (
          <p className="text-text-muted text-sm">{t('page.requoteIntro')}</p>
        ) : null}
      </section>

      <QuoteLinesTable lines={quote.lines} caption={t('page.linesCaption')} />
      <QuoteTotals totals={quote.totals} supplyKind={quote.supplyKind} />

      {withdrawing ? (
        <WithdrawDialog
          quote={quote}
          onCancel={() => {
            setWithdrawing(false);
          }}
          onDone={(withdrawn) => {
            setWithdrawing(false);
            setQuote(withdrawn);
            toast.success(t('page.withdrawn'));
          }}
        />
      ) : null}
    </Page>
  );
}

function WithdrawDialog({
  quote,
  onCancel,
  onDone,
}: {
  quote: QuoteDto;
  onCancel: () => void;
  onDone: (quote: QuoteDto) => void;
}) {
  const t = useTranslations('quotes.page');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(withdrawQuote);
  const { fieldError, formFailure } = useFieldFailure(failure, ['reason']);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const reason = formText(new FormData(e.currentTarget), 'reason').trim();
    run({ entityId: quote.entityId, quoteId: quote.id, reason }, onDone);
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('withdrawTitle')}</DialogTitle>
            <DialogDescription>{t('withdrawIntro')}</DialogDescription>
          </DialogHeader>
          <Field id="withdraw-reason" label={t('withdrawReason')} error={fieldError('reason')}>
            <Textarea name="reason" maxLength={300} rows={3} required />
          </Field>
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onCancel}>
              {common('cancel')}
            </Button>
            <Button type="submit" variant="danger" pending={pending}>
              {t('submitWithdraw')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
