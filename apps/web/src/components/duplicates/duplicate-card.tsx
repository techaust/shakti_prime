'use client';

import type { DuplicateRowDto, DuplicateSideDto } from '@shakti/contracts';
import { Button, StatusBadge, toast, type StatusTone } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { dismissDuplicate } from '../../actions/duplicates';
import { DUPLICATE_SIGNALS, OPPORTUNITY_STATES } from '../../screens/contract-values';
import { customerHref, isOneOf as oneOf } from '../../screens/customers';
import { formatDateTime } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

/** A surer match reads stronger; none of them is a decision. */
function matchTone(confidence: number): StatusTone {
  return confidence >= 85 ? 'warning' : 'info';
}

/** One side of the pair: the customer, and for a lead pair the lead. */
function Side({
  side,
  entityId,
  companies,
}: {
  side: DuplicateSideDto;
  entityId: number;
  companies: Record<number, string>;
}) {
  const t = useTranslations('duplicates');
  const leadsT = useTranslations('leads');
  const names = side.entityIds.map((e) => companies[e] ?? String(e));
  return (
    <div className="border-border bg-surface-2 flex min-w-0 flex-1 flex-col gap-1 rounded-md border p-3">
      <Link
        href={customerHref(side.accountId, entityId)}
        className="text-accent-text font-medium break-words hover:underline"
      >
        {side.accountName}
      </Link>
      <span className="text-text-muted text-sm">
        {side.phoneLast4 === null ? t('noPhone') : t('phoneEnding', { digits: side.phoneLast4 })}
      </span>
      <span className="text-text-muted text-sm break-words">{side.village ?? t('noVillage')}</span>
      {names.length === 0 ? null : (
        <span className="text-text-muted text-sm">
          {t('withCompanies', { companies: names.join(', ') })}
        </span>
      )}
      {side.opportunityId === null ? null : (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            {t('lead', { pipeline: side.pipelineName ?? '', stage: side.stageName ?? '' })}
          </span>
          {side.opportunityState !== null && oneOf(OPPORTUNITY_STATES, side.opportunityState) ? (
            <StatusBadge tone="neutral">{leadsT(`state.${side.opportunityState}`)}</StatusBadge>
          ) : null}
        </span>
      )}
      {side.opportunityId === null ? null : (
        <span className="text-text-muted text-sm">
          {side.ownerName === null ? t('noOwner') : t('owner', { name: side.ownerName })}
        </span>
      )}
    </div>
  );
}

/**
 * A duplicate card (CRM-03): the two customers, or the two leads, side by side with why they were
 * put forward and how sure the match is. A person holding `crm.lead.merge` merges them or sets the
 * pair aside; everyone else who sees both sides reads the card.
 */
export function DuplicateCard({
  row,
  companies,
  canMerge,
  onMerge,
  onDismissed,
  headingLevel = 'h2',
}: {
  row: DuplicateRowDto;
  companies: Record<number, string>;
  canMerge: boolean;
  onMerge: (row: DuplicateRowDto) => void;
  onDismissed: (id: string) => void;
  headingLevel?: 'h2' | 'h3';
}) {
  const t = useTranslations('duplicates');
  const dismiss = useCommand(dismissDuplicate);
  const Heading = headingLevel;
  const headingId = `duplicate-${row.id}`;
  return (
    <article
      aria-labelledby={headingId}
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading id={headingId} className="text-h3">
          {t(`kind.${row.kind}`)}
        </Heading>
        <StatusBadge tone={matchTone(row.confidence)}>
          {t('match', { confidence: row.confidence })}
        </StatusBadge>
      </div>
      <ul className="flex flex-wrap gap-2" aria-label={t(`reason.${row.reason}`)}>
        {row.signals.map((s) =>
          oneOf(DUPLICATE_SIGNALS, s) ? (
            <li key={s}>
              <StatusBadge tone="neutral">{t(`signal.${s}`)}</StatusBadge>
            </li>
          ) : null,
        )}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Side side={row.first} entityId={row.entityId} companies={companies} />
        <Side side={row.second} entityId={row.entityId} companies={companies} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-text-muted text-xs">
          {t('found', { when: formatDateTime(row.createdAt) })}
        </span>
        {canMerge ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              pending={dismiss.pending}
              onClick={() => {
                dismiss.run({ entityId: row.entityId, candidateId: row.id }, () => {
                  toast.success(t('notSameToast'));
                  onDismissed(row.id);
                });
              }}
            >
              {t('notSame')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onMerge(row);
              }}
            >
              {t('merge')}
            </Button>
          </div>
        ) : null}
      </div>
      <FailureMessage failure={dismiss.failure} />
    </article>
  );
}
