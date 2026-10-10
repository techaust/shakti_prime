'use client';

import type { CallLeadDto, ConvertingLeadDto, ConvertingPanel, SizingDto } from '@shakti/contracts';
import { Button, EmptyState, StatusBadge } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { customerHref } from '../../screens/customers';
import { formatCount, formatRupees } from '../../screens/format';
import { orderHref } from '../../screens/orders';
import { QUOTE_STATE_TONE } from '../../screens/quotes';
import { nextTab } from '../../screens/sizing';
import { panelsFor, sizingKindFor } from '../../screens/converting';
import { DialNumber, Outcomes, Panel } from '../calling/calling-parts';
import { TimelineRow } from '../customers/timeline-row';
import { DateTime } from '../date-time';
import { FailureMessage } from '../screens/failure';
import type { useCallLogging } from './use-call-logging';

// The sizing form and the quote form load when their panel first opens, so the screen's first
// load carries neither.
const SizingPanel = dynamic(() => import('../sizing/sizing-panel').then((m) => m.SizingPanel));
const QuotePanel = dynamic(() => import('./quote-panel').then((m) => m.QuotePanel));

// The dialog for an outcome's detail loads when an outcome first needs it, as in the calling
// workspace.
const OutcomeDialog = dynamic(() =>
  import('../calling/outcome-dialog').then((m) => m.OutcomeDialog),
);

/** What the summary says of the lead's sizing. */
function SizingSummary({ lead }: { lead: ConvertingLeadDto }) {
  const t = useTranslations('converting');
  const size = useTranslations('converting.size');
  if (lead.sizing === 'stale') return <>{t('lead.sizingStale')}</>;
  if (lead.size === null) return <>{t('lead.sizingNone')}</>;
  return lead.size.kind === 'pump' && lead.size.hp !== null ? (
    <>{size('hp', { hp: formatCount(lead.size.hp) })}</>
  ) : lead.size.kwp !== null ? (
    <>{size('kwp', { kwp: formatCount(lead.size.kwp) })}</>
  ) : (
    <>{t('lead.sizingNone')}</>
  );
}

/** The lead on one screen: its stage, next call, sizing, quote and any held order. */
function Summary({ lead, facts }: { lead: CallLeadDto; facts: ConvertingLeadDto | undefined }) {
  const t = useTranslations('converting');
  const calling = useTranslations('calling');
  const quotes = useTranslations('quotes.state');
  const row = 'flex min-w-0 flex-col gap-0.5';
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className={row}>
        <dt className="text-text-muted text-sm">{t('lead.stage')}</dt>
        <dd className="break-words">
          {calling('lead.stage', { pipeline: lead.pipelineName, stage: lead.stageName })}
        </dd>
      </div>
      <div className={row}>
        <dt className="text-text-muted text-sm">{t('lead.nextCall')}</dt>
        <dd>
          {lead.nextCall === null ? t('lead.noNextCall') : <DateTime value={lead.nextCall.dueAt} />}
        </dd>
      </div>
      <div className={row}>
        <dt className="text-text-muted text-sm">{t('lead.sizing')}</dt>
        <dd>{facts === undefined ? '' : <SizingSummary lead={facts} />}</dd>
      </div>
      <div className={row}>
        <dt className="text-text-muted text-sm">{t('lead.quote')}</dt>
        <dd className="flex flex-wrap items-center gap-2 break-words">
          {facts?.quote === undefined || facts.quote === null ? (
            t('lead.noQuote')
          ) : (
            <>
              <span>
                {t('lead.quoteLine', {
                  number: facts.quote.quoteNo,
                  state: quotes(facts.quote.state),
                })}{' '}
                <DateTime value={facts.quote.validUntil} />
              </span>
              <StatusBadge tone={QUOTE_STATE_TONE[facts.quote.state]}>
                {formatRupees(facts.quote.grandTotal)}
              </StatusBadge>
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** The calls panel: the number to dial, the outcomes and the lead's recent activity. */
function CallsPanel({
  lead,
  calling,
}: {
  lead: CallLeadDto;
  calling: ReturnType<typeof useCallLogging>;
}) {
  const t = useTranslations('calling');
  const { dial, save, picked } = calling;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <DialNumber
        lead={lead}
        shown={calling.shown}
        failure={dial.failure}
        pending={dial.pending}
        onShow={calling.showNumber}
      />
      <Outcomes lead={lead} pending={save.pending} onPick={calling.pick} />
      <FailureMessage failure={picked === undefined ? save.failure : undefined} />
      <Panel id="converting-activity" title={t('activity.title')}>
        {lead.recentActivity.length === 0 ? (
          <p className="text-text-muted">{t('activity.empty')}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {lead.recentActivity.map((item) => (
              <TimelineRow key={item.id} item={item} />
            ))}
          </ol>
        )}
      </Panel>
      {picked === undefined ? null : (
        <OutcomeDialog
          outcome={picked.outcome}
          need={picked.need}
          pending={save.pending}
          failure={save.failure}
          onSave={(detail) => {
            calling.saveCall(picked.outcome, detail);
          }}
          onCancel={() => {
            calling.setPicked(undefined);
          }}
        />
      )}
    </div>
  );
}

/** The order panel: the order the credit check holds, with a link to its page. */
function OrderPanel({ facts }: { facts: ConvertingLeadDto | undefined }) {
  const t = useTranslations('converting.order');
  const order = facts?.heldOrder;
  if (facts === undefined || order === null || order === undefined) return null;
  return (
    <div className="flex flex-col items-start gap-3">
      <p>
        {t('held', { number: order.soNo, amount: formatRupees(order.grandTotal) })} {t('heldSince')}{' '}
        <DateTime value={order.heldAt} />
      </p>
      <Button asChild variant="secondary">
        <Link href={orderHref(facts.entityId, order.id)}>{t('open')}</Link>
      </Button>
    </div>
  );
}

/**
 * The open lead: its name and where it stands, then the parts the converter works in (calls,
 * sizing, quote and a held order) as tabs that move with the arrow keys. The sizing panel and the
 * quote builder are the ones the lead's other screens use.
 */
export function LeadWorkspace({
  lead,
  facts,
  panel,
  onPanel,
  canWrite,
  calling,
  headingRef,
  panelRef,
  pending,
  onChanged,
}: {
  lead: CallLeadDto;
  facts: ConvertingLeadDto | undefined;
  panel: ConvertingPanel;
  onPanel: (panel: ConvertingPanel) => void;
  /** The caller may write the lead (`crm.lead.write`); the commands decide again on save. */
  canWrite: boolean;
  calling: ReturnType<typeof useCallLogging>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  pending: boolean;
  /** Told of each change (a call, a sizing, a quote), so the board reads again. */
  onChanged: (sizing?: SizingDto) => void;
}) {
  const t = useTranslations('converting');
  const calls = useTranslations('calling');
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const panels = panelsFor(facts);
  const active = panels.includes(panel) ? panel : 'calls';

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const next = nextTab(panels.indexOf(active), e.key, panels.length);
    const target = next === undefined ? undefined : panels[next];
    if (next === undefined || target === undefined) return;
    e.preventDefault();
    onPanel(target);
    tabs.current[next]?.focus();
  }

  const body: Record<ConvertingPanel, ReactNode> = {
    calls: <CallsPanel lead={lead} calling={calling} />,
    sizing: (
      <SizingPanel
        entityId={lead.entityId}
        opportunityId={lead.opportunityId}
        canWrite={canWrite}
        initialKind={sizingKindFor(lead.segment)}
        onSaved={(saved) => {
          onChanged(saved);
        }}
      />
    ),
    quote: (
      <QuotePanel
        entityId={lead.entityId}
        opportunityId={lead.opportunityId}
        onMade={() => {
          onChanged();
        }}
      />
    ),
    order: <OrderPanel facts={facts} />,
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section
        aria-labelledby="converting-lead"
        aria-busy={pending}
        className="border-border bg-surface flex min-w-0 flex-col gap-4 rounded-lg border p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h2
              id="converting-lead"
              ref={headingRef}
              tabIndex={-1}
              className="text-h2 truncate outline-none"
            >
              {lead.customerName}
            </h2>
            <p className="text-text-muted text-sm">
              {[lead.village, lead.district].filter((v) => v !== null).join(', ')}
              {lead.village === null && lead.district === null ? '' : ' · '}
              {calls('score', { score: lead.score })}
            </p>
          </div>
          <Button size="sm" variant="link" asChild>
            <Link href={customerHref(lead.accountId, lead.entityId)}>{t('lead.openCustomer')}</Link>
          </Button>
        </div>
        <Summary lead={lead} facts={facts} />
      </section>

      <div
        role="tablist"
        aria-label={t('lead.parts')}
        className="border-border flex flex-wrap gap-1 border-b"
      >
        {panels.map((name, index) => (
          <button
            key={name}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${name}`}
            aria-selected={active === name}
            aria-controls={`${id}-panel`}
            tabIndex={active === name ? 0 : -1}
            onClick={() => {
              onPanel(name);
            }}
            onKeyDown={onTabKey}
            className={
              active === name
                ? 'border-accent text-text -mb-px h-control border-b-2 px-3 font-medium'
                : 'text-text-muted hover:text-text -mb-px h-control border-b-2 border-transparent px-3'
            }
          >
            {t(`panel.${name}`)}
          </button>
        ))}
      </div>
      <div
        ref={panelRef}
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${active}`}
        className="flex min-w-0 flex-col gap-4"
      >
        {/* The sizing panel and the quote form load their own data; each is rebuilt for another lead. */}
        <div key={`${lead.opportunityId}:${active}`}>{body[active]}</div>
      </div>
    </div>
  );
}

/** What the workspace shows before a lead is chosen. */
export function NoLead() {
  const t = useTranslations('converting.lead');
  return <EmptyState message={t('empty')} />;
}
