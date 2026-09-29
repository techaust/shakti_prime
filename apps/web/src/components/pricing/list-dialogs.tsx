'use client';

import type { PriceListDto } from '@shakti/contracts';
import {
  Button,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Select,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { approvePriceList, createPriceList } from '../../actions/pricing';
import { istToday } from '../../screens/audit';
import { PRICE_TIER_CODES } from '../../screens/contract-values';
import { formatDate } from '../../screens/format';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

const FIELDS = ['tierCode', 'entityId', 'effectiveFrom'] as const;

/**
 * Starts a draft price list for a tier, for one company or all of them, from a date. A list for
 * all companies is offered only while the person acts for every company.
 */
export function NewListDialog({
  companies,
  coversAllCompanies,
  returnFocusTo,
  onClose,
  onCreated,
}: {
  companies: Record<number, string>;
  coversAllCompanies: boolean;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onCreated: (list: PriceListDto) => void;
}) {
  const t = useTranslations('priceMaster.newListDialog');
  const tiers = useTranslations('priceMaster.tiers');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(createPriceList);
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);
  const [fromWrong, setFromWrong] = useState(false);
  const companyIds = Object.keys(companies).map(Number);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const effectiveFrom = formText(data, 'effectiveFrom');
    const wrong = effectiveFrom === '' || effectiveFrom < istToday(new Date());
    setFromWrong(wrong);
    if (wrong) return;
    const company = formText(data, 'entityId');
    run(
      {
        tierCode: formText(data, 'tierCode'),
        ...(company === '' ? {} : { entityId: Number(company) }),
        effectiveFrom,
      },
      (created) => {
        toast.success(t('done'));
        onCreated(created);
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          <Field id="new-list-tier" label={t('tier')} error={fieldError('tierCode')}>
            <Select name="tierCode" defaultValue={PRICE_TIER_CODES[0]}>
              {PRICE_TIER_CODES.map((code) => (
                <option key={code} value={code}>
                  {tiers(code)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="new-list-company"
            label={t('company')}
            helper={coversAllCompanies ? undefined : t('companyHelper')}
            error={fieldError('entityId')}
          >
            <Select
              name="entityId"
              defaultValue={coversAllCompanies ? '' : String(companyIds[0] ?? '')}
            >
              {coversAllCompanies ? <option value="">{t('allCompanies')}</option> : null}
              {companyIds.map((id) => (
                <option key={id} value={String(id)}>
                  {companies[id]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="new-list-from"
            label={t('from')}
            helper={t('fromHelper')}
            error={fromWrong ? t('fromWrong') : fieldError('effectiveFrom')}
          >
            <DateInput name="effectiveFrom" defaultValue={istToday(new Date())} />
          </Field>
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Approves a draft list: from its start date, quotes use its prices. */
export function ApproveListDialog({
  list,
  listName,
  returnFocusTo,
  onClose,
  onApproved,
}: {
  list: PriceListDto;
  listName: string;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onApproved: (list: PriceListDto) => void;
}) {
  const t = useTranslations('priceMaster.approveDialog');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(approvePriceList);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <DialogHeader>
          <DialogTitle>{t('title', { list: listName })}</DialogTitle>
          <DialogDescription>
            {t('intro', { from: formatDate(list.effectiveFrom) })}
          </DialogDescription>
        </DialogHeader>
        <FailureMessage failure={failure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button
            pending={pending}
            onClick={() => {
              run({ priceListId: list.id }, (approved) => {
                toast.success(t('done', { list: listName }));
                onApproved(approved);
              });
            }}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
