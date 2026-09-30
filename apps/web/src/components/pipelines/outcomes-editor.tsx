'use client';

import type { DispositionDto, DispositionNextAction } from '@shakti/contracts';
import { Button, EmptyState, Field, Input, Select, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { listDispositions, setDispositions } from '../../actions/crm-settings';
import { DISPOSITION_NEXT_ACTIONS } from '../../screens/contract-values';
import {
  dispositionsInput,
  nextFreeKey,
  outcomeDrafts,
  scopeOf,
  type OutcomeDraft,
} from '../../screens/pipeline-settings';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import { ScopePicker, type ScopeValue } from './scope-picker';
import type { CompanyChoice } from './pipeline-settings-screen';

const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * The call outcomes of one scope, edited as a list and saved as a set (`crm.disposition.set`):
 * each with its number key, its name and what the queue does next.
 */
export function OutcomesEditor({
  companies,
  initial,
}: {
  companies: CompanyChoice[];
  initial: DispositionDto[];
}) {
  const t = useTranslations('pipelineSettings');
  const [scope, setScope] = useState<ScopeValue>({ company: 'group', segment: 'all' });
  const [drafts, setDrafts] = useState<OutcomeDraft[]>(() => outcomeDrafts(initial));
  const read = useQuery<{ dispositions: DispositionDto[] }>();
  const save = useCommand(setDispositions);
  const free = nextFreeKey(drafts);

  function choose(next: ScopeValue) {
    setScope(next);
    read.load(
      () => listDispositions(scopeOf(next.company, next.segment)),
      (list) => {
        setDrafts(outcomeDrafts(list.dispositions));
      },
    );
  }

  function change(rowId: string, patch: Partial<OutcomeDraft>) {
    setDrafts((all) => all.map((d) => (d.rowId === rowId ? { ...d, ...patch } : d)));
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.pending || read.pending) return;
    save.run(dispositionsInput(scopeOf(scope.company, scope.segment), drafts), (list) => {
      setDrafts(outcomeDrafts(list.dispositions));
      toast.success(t('outcomesSaved'));
    });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4 sm:p-5"
    >
      <ScopePicker idPrefix="outcomes" companies={companies} value={scope} onChange={choose} />
      <FailureMessage failure={read.failure} />
      {drafts.length === 0 ? (
        <EmptyState message={t('outcomesEmpty')} />
      ) : (
        <ul className="flex flex-col gap-3" aria-busy={read.pending || undefined}>
          {drafts.map((d, i) => (
            <li
              key={d.rowId}
              className="border-border grid gap-3 rounded-lg border p-3 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
            >
              <Field id={`outcome-${d.rowId}-key`} label={t('outcomeKey')}>
                <Select
                  value={String(d.key)}
                  onChange={(e) => {
                    change(d.rowId, { key: Number(e.currentTarget.value) });
                  }}
                >
                  {KEYS.map((key) => (
                    <option key={key} value={String(key)}>
                      {key}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`outcome-${d.rowId}-label`} label={t('outcomeLabel')}>
                <Input
                  value={d.label}
                  required
                  minLength={2}
                  maxLength={40}
                  autoComplete="off"
                  onChange={(e) => {
                    change(d.rowId, { label: e.currentTarget.value });
                  }}
                />
              </Field>
              <Field id={`outcome-${d.rowId}-next`} label={t('outcomeNext')}>
                <Select
                  value={d.nextAction}
                  onChange={(e) => {
                    change(d.rowId, { nextAction: e.currentTarget.value as DispositionNextAction });
                  }}
                >
                  {DISPOSITION_NEXT_ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {t(`nextAction.${action}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                type="button"
                variant="ghost"
                aria-label={
                  d.label.trim() === ''
                    ? t('removeUnnamed')
                    : t('removeLabel', { name: d.label.trim() })
                }
                onClick={() => {
                  setDrafts((all) => all.filter((x) => x.rowId !== d.rowId));
                  // Focus stays in the list: on the row that takes this one's place.
                  setTimeout(() => {
                    const next = drafts[i + 1] ?? drafts[i - 1];
                    document
                      .getElementById(
                        next === undefined ? 'outcomes-add' : `outcome-${next.rowId}-key`,
                      )
                      ?.focus();
                  });
                }}
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FailureMessage failure={save.failure} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <Button
            id="outcomes-add"
            type="button"
            variant="secondary"
            disabled={free === undefined || read.pending}
            onClick={() => {
              if (free === undefined) return;
              const rowId = crypto.randomUUID();
              setDrafts((all) => [...all, { rowId, key: free, label: '', nextAction: 'callback' }]);
              setTimeout(() => {
                document.getElementById(`outcome-${rowId}-label`)?.focus();
              });
            }}
          >
            {t('addOutcome')}
          </Button>
          {free === undefined ? <p className="text-text-muted text-sm">{t('keysFull')}</p> : null}
        </div>
        <Button type="submit" pending={save.pending} disabled={read.pending}>
          {t('saveOutcomes')}
        </Button>
      </div>
    </form>
  );
}
