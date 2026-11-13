'use client';

import type {
  PlaybookDirectiveDto,
  PlaybookDirectiveState,
  PlaybookResolution,
  PlaybookReviewDto,
} from '@shakti/contracts';
import { Button, Skeleton, StatusBadge, type StatusTone } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { formatDate } from '../../screens/format';
import { approvable, openPairs } from '../../screens/playbook';
import { FailureMessage } from '../screens/failure';
import type { CommandFailure } from '../screens/use-command';

export const STATE_TONE: Readonly<Record<PlaybookDirectiveState, StatusTone>> = {
  draft: 'info',
  approved: 'success',
  retired: 'neutral',
};

/** The dialog the review opens. */
export type PlaybookDialog =
  | { kind: 'new' }
  | { kind: 'draftFromFile' }
  | { kind: 'edit'; directive: PlaybookDirectiveDto }
  | { kind: 'retire'; directive: PlaybookDirectiveDto }
  | {
      kind: 'resolve';
      directive: PlaybookDirectiveDto;
      checkId: string;
      resolution: PlaybookResolution;
      otherTitle: string;
    };

/**
 * The review of one rule: its wording, where it comes from (the vault passage beside it), whether
 * the check has run, and each approved rule it was compared with side by side, with the clash
 * and how it was settled. Approve, Edit and Retire act on the rule; Not a clash and Retire the
 * other rule settle a clash.
 */
export function PlaybookReview({
  review,
  loading,
  failure,
  companyName,
  canApprove,
  approving,
  onApprove,
  onDialog,
}: {
  review: PlaybookReviewDto | undefined;
  loading: boolean;
  failure: CommandFailure | undefined;
  companyName: (id: number | null) => string | undefined;
  canApprove: boolean;
  approving: boolean;
  onApprove: () => void;
  onDialog: (dialog: PlaybookDialog) => void;
}) {
  const t = useTranslations('playbook');
  if (review === undefined) {
    return (
      <section aria-labelledby="playbook-review" className="flex min-w-0 flex-col gap-3">
        <h2 id="playbook-review" className="text-h3">
          {t('review.heading')}
        </h2>
        <FailureMessage failure={failure} />
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <p className="text-text-muted">{t('review.nothingChosen')}</p>
        )}
      </section>
    );
  }
  const d = review.directive;
  const open = new Set(openPairs(review).map((p) => p.check.id));
  return (
    <section
      aria-labelledby="playbook-review"
      aria-busy={loading}
      className="border-border bg-surface flex min-w-0 flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="playbook-review" className="text-h3 break-words">
          {d.title}
        </h2>
        <p className="text-text-muted flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge tone={STATE_TONE[d.state]}>{t(`state.${d.state}`)}</StatusBadge>
          <span>
            {t(`type.${d.type}`)} · {t(`audience.${d.audience}`)} ·{' '}
            {companyName(d.entityId) ?? t('list.everyCompany')}
          </span>
        </p>
      </div>
      <FailureMessage failure={failure} />
      <p className="break-words whitespace-pre-line">{d.text}</p>
      {d.approvedAt === null ? null : (
        <p className="text-text-muted text-sm">
          {t('review.approved', { date: formatDate(d.approvedAt) })}
        </p>
      )}
      {d.retiredAt === null ? null : (
        <p className="text-text-muted text-sm">
          {t('review.retired', { date: formatDate(d.retiredAt), reason: d.retiredReason ?? '' })}
        </p>
      )}
      <div
        role="group"
        aria-label={t('review.actions', { title: d.title })}
        className="flex flex-wrap gap-2"
      >
        {d.state === 'draft' && canApprove ? (
          <Button pending={approving} disabled={!approvable(review)} onClick={onApprove}>
            {t('approve')}
          </Button>
        ) : null}
        {d.state === 'draft' ? (
          <Button
            variant="secondary"
            onClick={() => {
              onDialog({ kind: 'edit', directive: d });
            }}
          >
            {t('edit')}
          </Button>
        ) : null}
        {d.state === 'draft' || (d.state === 'approved' && canApprove) ? (
          <Button
            variant="secondary"
            onClick={() => {
              onDialog({ kind: 'retire', directive: d });
            }}
          >
            {t('retire')}
          </Button>
        ) : null}
      </div>
      <p className="text-text-subtle text-xs">{t('review.keys')}</p>

      <section aria-labelledby="playbook-source" className="flex flex-col gap-2">
        <h3 id="playbook-source" className="font-medium">
          {t('review.source')}
        </h3>
        {review.source === null ? (
          <p className="text-text-muted text-sm">{t('review.typedIn')}</p>
        ) : (
          <div className="bg-surface-2 flex flex-col gap-1 rounded-md p-3">
            <p className="text-text-muted text-sm">
              {t('review.sourceFile', { title: review.source.title })}
            </p>
            <p className="text-sm break-words whitespace-pre-line">
              {review.source.text ?? t('review.sourceGone')}
            </p>
          </div>
        )}
      </section>

      {d.state !== 'draft' ? null : (
        <section aria-labelledby="playbook-pairs" className="flex flex-col gap-3">
          <h3 id="playbook-pairs" className="font-medium">
            {t('review.pairs')}
          </h3>
          {d.checkedAt === null ? (
            <p className="text-text-muted text-sm" role="status">
              {t('review.checking')}
            </p>
          ) : review.pairs.length === 0 ? (
            <p className="text-text-muted text-sm">{t('review.clear')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {review.pairs.map(({ check, other }) => (
                <li
                  key={check.id}
                  className="border-border flex flex-col gap-3 rounded-md border p-3"
                >
                  <p className="text-sm font-medium">
                    {check.label === null
                      ? t('review.unlabelled')
                      : t(`review.label.${check.label}`)}
                    {check.reason === null ? null : (
                      <span className="text-text-muted font-normal"> {check.reason}</span>
                    )}
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="bg-surface-2 flex flex-col gap-1 rounded-md p-3">
                      <p className="text-text-muted text-xs font-medium">{t('review.thisRule')}</p>
                      <p className="text-sm break-words whitespace-pre-line">{d.text}</p>
                    </div>
                    <div className="bg-surface-2 flex flex-col gap-1 rounded-md p-3">
                      <p className="text-text-muted text-xs font-medium">{t('review.otherRule')}</p>
                      {other === null ? (
                        <p className="text-text-muted text-sm">{t('review.otherHidden')}</p>
                      ) : (
                        <>
                          <p className="text-sm font-medium break-words">{other.title}</p>
                          <p className="text-sm break-words whitespace-pre-line">{other.text}</p>
                        </>
                      )}
                    </div>
                  </div>
                  {check.resolution === null ? null : (
                    <p className="text-text-muted text-sm">
                      {t('review.settled', { resolution: t(`resolution.${check.resolution}`) })}
                      {check.resolutionNote === null ? '' : ` ${check.resolutionNote}`}
                    </p>
                  )}
                  {open.has(check.id) && canApprove && other !== null ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          onDialog({
                            kind: 'resolve',
                            directive: d,
                            checkId: check.id,
                            resolution: 'not_a_conflict',
                            otherTitle: other.title,
                          });
                        }}
                      >
                        {t('notAClash')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          onDialog({
                            kind: 'resolve',
                            directive: d,
                            checkId: check.id,
                            resolution: 'other_retired',
                            otherTitle: other.title,
                          });
                        }}
                      >
                        {t('retireOther')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
