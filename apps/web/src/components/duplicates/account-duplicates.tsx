'use client';

import type { AccountDuplicatesDto, DuplicateRowDto } from '@shakti/contracts';
import { Button, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { listAccountDuplicates, unmergeCustomers } from '../../actions/duplicates';
import { customerHref } from '../../screens/customers';
import { formatDateTime } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import { DuplicateCard } from './duplicate-card';

const MergeDialog = dynamic(() => import('./merge-dialog').then((m) => m.MergeDialog));

/**
 * The duplicate cards of Account 360 (CRM-03): the possible duplicates of this customer and of
 * its leads in the company, and the customers merged into it with the button that undoes each
 * merge. After a merge the page shows the customer kept; after an undo it reads this one again
 * (`onChanged`).
 */
export function AccountDuplicates({
  initial,
  accountId,
  entityId,
  companies,
  onChanged,
}: {
  initial: AccountDuplicatesDto;
  accountId: string;
  entityId: number;
  companies: Record<number, string>;
  onChanged: () => void;
}) {
  const t = useTranslations('duplicates');
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [rows, setRows] = useState(initial.candidates);
  const reread = useQuery<AccountDuplicatesDto>();

  function reload() {
    reread.load(
      () => listAccountDuplicates({ entityId, accountId }),
      (next) => {
        setView(next);
        setRows(next.candidates);
      },
    );
    onChanged();
  }
  const [merging, setMerging] = useState<DuplicateRowDto | undefined>();
  const [undoing, setUndoing] = useState<string | undefined>();
  const undo = useCommand(unmergeCustomers);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {rows.length === 0 ? null : (
        <section aria-labelledby="account-duplicates" className="flex min-w-0 flex-col gap-3">
          <h2 id="account-duplicates" className="text-h3">
            {t('accountSection')}
          </h2>
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id}>
                <DuplicateCard
                  row={row}
                  companies={companies}
                  canMerge={view.canMerge}
                  headingLevel="h3"
                  onMerge={setMerging}
                  onDismissed={(id) => {
                    setRows((all) => all.filter((r) => r.id !== id));
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.merges.length === 0 ? null : (
        <section
          aria-labelledby="account-merges"
          className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
        >
          <h2 id="account-merges" className="text-h3">
            {t('mergedSection')}
          </h2>
          <FailureMessage failure={undo.failure ?? reread.failure} />
          <ul className="flex flex-col gap-3">
            {view.merges.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">
                  {m.mergedAccountName === null
                    ? t('mergedFromUnnamed', { when: formatDateTime(m.mergedAt) })
                    : t('mergedFrom', {
                        name: m.mergedAccountName,
                        when: formatDateTime(m.mergedAt),
                      })}
                </span>
                {view.canMerge ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    pending={undo.pending && undoing === m.id}
                    onClick={() => {
                      setUndoing(m.id);
                      undo.run({ entityId: m.entityId, mergeId: m.id }, () => {
                        toast.success(t('undoneToast'));
                        reload();
                      });
                    }}
                  >
                    {t('undo')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      {merging === undefined ? null : (
        <MergeDialog
          row={merging}
          onCancel={() => {
            setMerging(undefined);
          }}
          onDone={(outcome) => {
            setMerging(undefined);
            // The customer on screen may have been the one merged away: show the one kept.
            if (outcome.mergedAccountId === accountId) {
              router.push(customerHref(outcome.keptAccountId, entityId));
            } else {
              reload();
            }
          }}
        />
      )}
    </div>
  );
}
