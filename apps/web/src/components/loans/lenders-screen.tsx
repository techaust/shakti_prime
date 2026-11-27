'use client';

import type { LenderDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  StatusBadge,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { createLender, listLenders, updateLender } from '../../actions/loans';
import { lenderNameOk } from '../../screens/loans';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { settle } from '../screens/settle';
import { useCommand, type CommandFailure } from '../screens/use-command';

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

function LenderDialog({
  entityId,
  lender,
  onClose,
  onSaved,
}: {
  entityId: number;
  lender: LenderDto | undefined;
  onClose: () => void;
  onSaved: (saved: string) => void;
}) {
  const t = useTranslations('loans.lenders');
  const common = useTranslations('common');
  const add = useCommand(createLender);
  const rename = useCommand(updateLender);
  const command = lender === undefined ? add : rename;
  const { fieldError, formFailure } = useFieldFailure(command.failure, ['name']);
  const [problem, setProblem] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (command.pending) return;
    const name = formText(new FormData(e.currentTarget), 'name').trim();
    if (!lenderNameOk(name)) {
      setProblem(true);
      return;
    }
    setProblem(false);
    if (lender === undefined) {
      add.run({ entityId, name }, () => {
        onSaved(t('added'));
      });
    } else {
      rename.run({ entityId, lenderId: lender.id, name }, () => {
        onSaved(t('renamed'));
      });
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{lender === undefined ? t('addTitle') : t('renameTitle')}</DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          <Field
            id="lender-name"
            label={t('nameLabel')}
            error={problem ? t('nameInvalid') : fieldError('name')}
          >
            <Input
              name="name"
              autoComplete="off"
              maxLength={120}
              defaultValue={lender?.name ?? ''}
              required
            />
          </Field>
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={command.pending}>
              {lender === undefined ? t('submitAdd') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
