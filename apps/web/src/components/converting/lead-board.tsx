'use client';

import type { ConvertingBoardDto, ConvertingLeadDto, NextActionDto } from '@shakti/contracts';
import { Button, cn, EmptyState, StatusBadge } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import { formatCount } from '../../screens/format';
import { groupByStage, leadKey } from '../../screens/converting';
import { QUOTE_STATE_TONE } from '../../screens/quotes';
import { DateTime } from '../date-time';

/** A lead's size in words: a pump's horsepower or a rooftop system's kilowatts. */
function useSizeText() {
  const t = useTranslations('converting.size');
  return (size: NonNullable<ConvertingLeadDto['size']>): string | undefined =>
    size.kind === 'pump' && size.hp !== null
      ? t('hp', { hp: formatCount(size.hp) })
      : size.kind === 'rooftop' && size.kwp !== null
        ? t('kwp', { kwp: formatCount(size.kwp) })
        : undefined;
}

/** The list the rules make: each row is a lead and why it is there, and opens the lead at its panel. */
export function NextActions({
  actions,
  onOpen,
}: {
  actions: readonly NextActionDto[];
  onOpen: (action: NextActionDto) => void;
}) {
  const t = useTranslations('converting.next');
  return (
    <section
      aria-labelledby="converting-next"
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="converting-next" className="text-h3">
        {t('title')}
      </h2>
      {actions.length === 0 ? (
        <EmptyState message={t('empty')} className="py-6" />
      ) : (
        <ol className="flex flex-col gap-1">
          {actions.map((action) => (
            <li key={`${action.opportunityId}:${action.rule}`}>
              <Button
                variant="ghost"
                className="h-auto w-full flex-col items-start gap-0.5 py-2 text-left"
                data-rule={action.rule}
                onClick={() => {
                  onOpen(action);
                }}
              >
                <span className="w-full truncate font-medium">{action.customerName}</span>
                <span className="text-text-muted w-full text-sm font-normal whitespace-normal">
                  {t(`rule.${action.rule}`)}
                  {action.at === null ? null : (
                    <>
                      {' '}
                      <DateTime value={action.at} />
                    </>
                  )}
                </span>
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** One lead on the board: the customer, where, and the few facts that say what it needs. */
function LeadCard({
  lead,
  asOf,
  selected,
  buttons,
  onOpen,
}: {
  lead: ConvertingLeadDto;
  asOf: number;
  selected: boolean;
  buttons: RefObject<Map<string, HTMLButtonElement>>;
  onOpen: (lead: ConvertingLeadDto) => void;
}) {
  const t = useTranslations('converting.board');
  const quotes = useTranslations('quotes.state');
  const sizeText = useSizeText();
  const key = leadKey({ entityId: lead.entityId, opportunityId: lead.opportunityId });
  const size = lead.size === null ? undefined : sizeText(lead.size);
  // --accent-soft carries --text at AA but not --text-muted in the dark theme, so the selected
  // card's secondary lines take the full text colour.
  const muted = selected ? 'text-text' : 'text-text-muted';
  const callDue = lead.nextCall !== null && Date.parse(lead.nextCall.dueAt) <= asOf;
  return (
    <button
      type="button"
      ref={(element) => {
        const all = buttons.current;
        if (element === null) all.delete(key);
        else all.set(key, element);
      }}
      aria-current={selected ? 'true' : undefined}
      data-lead={key}
      onClick={() => {
        onOpen(lead);
      }}
      className={cn(
        'hover:bg-surface-2 flex w-full min-w-0 flex-col gap-1 rounded-md border px-3 py-2 text-left',
        selected ? 'border-accent bg-accent-soft' : 'border-transparent',
      )}
    >
      <span className="truncate font-medium">{lead.customerName}</span>
      <span className={cn(muted, 'truncate text-sm')}>
        {[lead.village, lead.pipelineName].filter((v) => v !== null).join(' · ')}
      </span>
      <span className="flex flex-wrap items-center gap-1">
        {callDue ? <StatusBadge tone="warning">{t('callDue')}</StatusBadge> : null}
        {lead.heldOrder === null ? null : <StatusBadge tone="danger">{t('orderHeld')}</StatusBadge>}
        {lead.quote === null ? null : (
          <StatusBadge tone={QUOTE_STATE_TONE[lead.quote.state]}>
            {quotes(lead.quote.state)}
          </StatusBadge>
        )}
        {size !== undefined ? (
          <StatusBadge tone="neutral">{size}</StatusBadge>
        ) : lead.needsQuote && lead.segment !== 'dealer_wholesale' ? (
          <StatusBadge tone="neutral">{t('notSized')}</StatusBadge>
        ) : null}
      </span>
    </button>
  );
}

/**
 * The converter's board: their open leads in a column for each stage. `J` and `K` move the
 * keyboard from lead to lead (the screen finds the buttons through `buttons`), and Enter opens the
 * one it is on.
 */
export function StageBoard({
  board,
  current,
  buttons,
  pending,
  onOpen,
  onRefresh,
}: {
  board: ConvertingBoardDto;
  current: string | undefined;
  buttons: RefObject<Map<string, HTMLButtonElement>>;
  pending: boolean;
  onOpen: (lead: ConvertingLeadDto) => void;
  onRefresh: () => void;
}) {
  const t = useTranslations('converting.board');
  const groups = groupByStage(board.leads);
  const asOf = Date.parse(board.asOf);
  return (
    <section
      aria-labelledby="converting-board"
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="converting-board" className="text-h3">
          {t('title')}
        </h2>
        <Button size="sm" variant="ghost" pending={pending} onClick={onRefresh}>
          {t('refresh')}
        </Button>
      </div>
      <p className="text-text-muted text-sm" aria-live="polite">
        {t('count', { count: board.leads.length })} · {t('asOf')} <DateTime value={board.asOf} />
      </p>
      {board.truncated ? <p className="text-text-muted text-sm">{t('truncated')}</p> : null}
      {groups.length === 0 ? (
        <EmptyState message={t('empty')} className="py-8" />
      ) : (
        groups.map((group) => (
          <section
            key={group.key}
            aria-labelledby={`converting-stage-${group.key}`}
            className="flex flex-col gap-1"
          >
            <h3
              id={`converting-stage-${group.key}`}
              className="text-text-muted text-sm font-medium"
            >
              {group.name} · {formatCount(group.leads.length)}
            </h3>
            <ul className="flex flex-col gap-1">
              {group.leads.map((lead) => (
                <li key={lead.opportunityId}>
                  <LeadCard
                    lead={lead}
                    asOf={asOf}
                    selected={lead.opportunityId === current}
                    buttons={buttons}
                    onOpen={onOpen}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
