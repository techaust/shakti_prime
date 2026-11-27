'use client';

import type { LenderDto } from '@shakti/contracts';
import { Button, Field, Select, StatusBadge, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { listLenders, updateLender } from '../../actions/loans';
import { FailureMessage } from '../screens/failure';
import { settle } from '../screens/settle';
import { useCommand, type CommandFailure } from '../screens/use-command';

/** The add and rename dialog loads on first use. */
const LenderDialog = dynamic(() => import('./lender-dialog').then((m) => m.LenderDialog));

interface Company {
  id: number;
  name: string;
}

/**
 * Settings › Lenders (docs/03-roadmap-appendix/phase4.md §6.2): one company's lenders at a time,
 * by name. The Executive adds a lender, renames one, or switches one off (it is then no longer
 * offered for new loans, and the loans that name it keep it) or on again. While a company has no
 * lender in use, people type the lender's name when they record a loan.
 */
export function LendersScreen({
  companies,
  initialCompany,
  initial,
}: {
  companies: readonly Company[];
  initialCompany: number;
  initial: readonly LenderDto[];
}) {
  const t = useTranslations('loans.lenders');
  const [company, setCompany] = useState(initialCompany);
  const [lenders, setLenders] = useState(initial);
  const [editing, setEditing] = useState<LenderDto | 'new' | undefined>();
  const [failure, setFailure] = useState<CommandFailure | undefined>();
  const toggle = useCommand(updateLender);

  async function load(entityId: number) {
    const result = await settle(() => listLenders({ entityId }));
    if (result.ok) {
      setLenders(result.data);
      setFailure(undefined);
    } else {
      setFailure((previous) => ({
        error: result.error,
        reference: result.reference,
        attempt: (previous?.attempt ?? 0) + 1,
      }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {companies.length > 1 ? (
          <div className="w-full max-w-xs">
            <Field id="lenders-company" label={t('company')}>
              <Select
                value={String(company)}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setCompany(next);
                  void load(next);
                }}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}
        <Button
          className="self-start"
          onClick={() => {
            setEditing('new');
          }}
        >
          {t('add')}
        </Button>
      </div>
      <FailureMessage failure={failure ?? toggle.failure} />
      {lenders.length === 0 ? (
        <p className="text-text-muted">{t('empty')}</p>
      ) : (
        <ul aria-label={t('caption')} className="border-border flex flex-col rounded-lg border">
          {lenders.map((lender) => (
            <li
              key={lender.id}
              className="border-border flex flex-wrap items-center justify-between gap-2 border-t p-3 first:border-t-0"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-medium break-words">{lender.name}</span>
                <StatusBadge tone={lender.isActive ? 'success' : 'neutral'}>
                  {lender.isActive ? t('active') : t('inactive')}
                </StatusBadge>
              </span>
              <span className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={t('renameAria', { name: lender.name })}
                  onClick={() => {
                    setEditing(lender);
                  }}
                >
                  {t('renameLender')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  pending={toggle.pending}
                  aria-label={
                    lender.isActive
                      ? t('switchOffAria', { name: lender.name })
                      : t('switchOnAria', { name: lender.name })
                  }
                  onClick={() => {
                    toggle.run(
                      { entityId: company, lenderId: lender.id, isActive: !lender.isActive },
                      (saved) => {
                        toast.success(saved.isActive ? t('switchedOn') : t('switchedOff'));
                        void load(company);
                      },
                    );
                  }}
                >
                  {lender.isActive ? t('switchOff') : t('switchOn')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing === undefined ? null : (
        <LenderDialog
          entityId={company}
          lender={editing === 'new' ? undefined : editing}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={(saved) => {
            setEditing(undefined);
            toast.success(saved);
            void load(company);
          }}
        />
      )}
    </div>
  );
}
