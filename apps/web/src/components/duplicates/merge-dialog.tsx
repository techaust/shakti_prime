'use client';

import type {
  CustomerMergeDto,
  CustomerMergeMovedDto,
  DuplicateRowDto,
  DuplicateSideDto,
} from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { mergeCustomers, mergeLeads, previewCustomerMerge } from '../../actions/duplicates';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';

/** What a merge did, for the screen to move on: the customer kept, and the merge to undo. */
export interface MergeOutcome {
  keptAccountId: string;
  mergedAccountId: string;
  merge: CustomerMergeDto | undefined;
}

const COUNT_KEYS = [
  'leads',
  'contacts',
  'sites',
  'relationships',
  'consents',
  'tasks',
  'tags',
  'activities',
] as const satisfies readonly (keyof CustomerMergeMovedDto)[];

function sideLabel(side: DuplicateSideDto): string {
  return side.opportunityId === null
    ? side.accountName
    : `${side.accountName}, ${side.pipelineName ?? ''}`;
}

/**
 * The merge dialog (CRM-03): which of the two to keep, and, for customers, what will move to the
 * kept one, counted before anyone confirms. A customer merge can be undone from the kept
 * customer's page (`crm.customer.unmerge`); a lead merge closes the other lead.
 */
export function MergeDialog({
  row,
  onDone,
  onCancel,
}: {
  row: DuplicateRowDto;
  onDone: (outcome: MergeOutcome) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('duplicates.dialog');
  const common = useTranslations('common');
  const [keep, setKeep] = useState<'first' | 'second'>('first');
  const [moved, setMoved] = useState<CustomerMergeMovedDto | undefined>();
  const preview = useQuery<CustomerMergeMovedDto>();
  const customers = useCommand(mergeCustomers);
  const leads = useCommand(mergeLeads);
  const kept = keep === 'first' ? row.first : row.second;
  const merged = keep === 'first' ? row.second : row.first;
  const isCustomers = row.kind === 'customer';
  const pending = customers.pending || leads.pending;

  const { load } = preview;
  useEffect(() => {
    if (!isCustomers) return;
    setMoved(undefined);
    load(
      () =>
        previewCustomerMerge({
          entityId: row.entityId,
          keptAccountId: kept.accountId,
          mergedAccountId: merged.accountId,
        }),
      setMoved,
    );
  }, [isCustomers, load, row.entityId, kept.accountId, merged.accountId]);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (isCustomers) {
      customers.run(
        {
          entityId: row.entityId,
          keptAccountId: kept.accountId,
          mergedAccountId: merged.accountId,
          candidateId: row.id,
        },
        (merge) => {
          toast.success(t('mergedToast'));
          onDone({ keptAccountId: kept.accountId, mergedAccountId: merged.accountId, merge });
        },
      );
      return;
    }
    leads.run(
      {
        entityId: row.entityId,
        keptOpportunityId: kept.opportunityId,
        mergedOpportunityId: merged.opportunityId,
        candidateId: row.id,
      },
      () => {
        toast.success(t('leadsMergedToast'));
        onDone({ keptAccountId: kept.accountId, mergedAccountId: merged.accountId, merge: undefined });
      },
    );
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
            <DialogTitle>{isCustomers ? t('customerTitle') : t('leadTitle')}</DialogTitle>
            <DialogDescription>{isCustomers ? t('customerIntro') : t('leadIntro')}</DialogDescription>
          </DialogHeader>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-text-muted mb-1 text-sm font-medium">{t('keepLegend')}</legend>
            {(['first', 'second'] as const).map((which) => {
              const side = which === 'first' ? row.first : row.second;
              return (
                <label key={which} className="inline-flex min-h-8 items-center gap-2">
                  <input
                    type="radio"
                    name="keep"
                    value={which}
                    checked={keep === which}
                    onChange={() => {
                      setKeep(which);
                    }}
                    className="accent-accent size-4"
                  />
                  <span className="break-words">{sideLabel(side)}</span>
                </label>
              );
            })}
          </fieldset>
          {isCustomers ? (
            <section aria-labelledby="merge-moves" className="flex flex-col gap-2">
              <h3 id="merge-moves" className="text-sm font-medium">
                {t('moves')}
              </h3>
              <FailureMessage failure={preview.failure} />
              {moved === undefined ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  {COUNT_KEYS.map((key) => (
                    <div key={key} className="flex flex-col">
                      <dt className="text-text-muted">{t(`counts.${key}`)}</dt>
                      <dd className="tabular-nums">{moved[key]}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ) : null}
          <FailureMessage failure={customers.failure ?? leads.failure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onCancel}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {isCustomers ? t('submitCustomers') : t('submitLeads')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
