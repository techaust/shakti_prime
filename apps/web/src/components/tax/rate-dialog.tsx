'use client';

import type { ItemDto } from '@shakti/contracts';
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
  Input,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { setTaxRate } from '../../actions/tax';
import { percentFromTyped } from '../../screens/catalogue';
import { ItemPicker } from '../catalogue/item-picker';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

const FIELDS = ['hsn', 'itemId', 'ratePct', 'effectiveFrom', 'effectiveTo', 'sourceRef'] as const;

type Problem = 'hsn' | 'item' | 'rate' | 'from' | 'to';

/** Adds a GST rate for an HSN code or one item, from a date (`tax.rate.set`). */
export function RateDialog({
  returnFocusTo,
  onClose,
  onSaved,
}: {
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('taxSettings.rateDialog');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setTaxRate);
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);
  const [target, setTarget] = useState<'hsn' | 'item'>('hsn');
  const [item, setItem] = useState<ItemDto | undefined>();
  const [problems, setProblems] = useState<ReadonlySet<Problem>>(new Set());
  // What is typed in the end date, so a date typed wrong is told from one left empty.
  const [toText, setToText] = useState('');

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const hsn = formText(data, 'hsn').trim();
    const ratePct = percentFromTyped(formText(data, 'ratePct'));
    const effectiveFrom = formText(data, 'effectiveFrom');
    const effectiveTo = formText(data, 'effectiveTo');
    const sourceRef = formText(data, 'sourceRef').trim();
    const found = new Set<Problem>();
    if (target === 'hsn' && !/^(\d{4}|\d{6}|\d{8})$/.test(hsn)) found.add('hsn');
    if (target === 'item' && item === undefined) found.add('item');
    if (ratePct === undefined) found.add('rate');
    if (effectiveFrom === '') found.add('from');
    if (toText.trim() !== '' && effectiveTo === '') found.add('to');
    setProblems(found);
    if (found.size > 0 || ratePct === undefined) return;
    run(
      {
        ...(target === 'hsn' ? { hsn } : { itemId: item?.id }),
        ratePct,
        effectiveFrom,
        ...(effectiveTo === '' ? {} : { effectiveTo }),
        ...(sourceRef === '' ? {} : { sourceRef }),
      },
      () => {
        toast.success(t('done'));
        onSaved();
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
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">{t('target')}</legend>
            {(['hsn', 'item'] as const).map((choice) => (
              <label key={choice} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="target"
                  value={choice}
                  className="accent-accent size-4"
                  checked={target === choice}
                  onChange={() => {
                    setTarget(choice);
                  }}
                />
                {choice === 'hsn' ? t('byHsn') : t('byItem')}
              </label>
            ))}
          </fieldset>
          {target === 'hsn' ? (
            <Field
              id="rate-hsn"
              label={t('hsn')}
              helper={t('hsnHelper')}
              error={problems.has('hsn') ? t('hsnWrong') : fieldError('hsn')}
            >
              <Input
                name="hsn"
                inputMode="numeric"
                maxLength={8}
                autoComplete="off"
                className="tabular-nums"
              />
            </Field>
          ) : (
            <div className="flex flex-col gap-2">
              {item === undefined ? null : (
                <p className="font-medium">{t('chosen', { name: `${item.name} (${item.sku})` })}</p>
              )}
              <ItemPicker
                id="rate-item"
                label={t('find')}
                helper={t('findHelper')}
                noneFound={t('noneFound')}
                chooseLabel={t('choose')}
                chooseFor={(i) => t('chooseItem', { name: i.name })}
                onChoose={(chosen) => {
                  setItem(chosen);
                }}
              />
              {problems.has('item') ? (
                <p role="alert" className="text-danger">
                  {t('itemMissing')}
                </p>
              ) : null}
            </div>
          )}
          <Field
            id="rate-pct"
            label={t('rate')}
            helper={t('rateHelper')}
            error={problems.has('rate') ? t('rateWrong') : fieldError('ratePct')}
          >
            <Input
              name="ratePct"
              inputMode="decimal"
              maxLength={6}
              autoComplete="off"
              className="tabular-nums"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="rate-from"
              label={t('from')}
              error={problems.has('from') ? t('dateWrong') : fieldError('effectiveFrom')}
            >
              <DateInput name="effectiveFrom" />
            </Field>
            <Field
              id="rate-to"
              label={t('to')}
              helper={t('toHelper')}
              error={problems.has('to') ? t('dateWrong') : fieldError('effectiveTo')}
            >
              <DateInput
                name="effectiveTo"
                onValueChange={(_iso, text) => {
                  setToText(text);
                }}
              />
            </Field>
          </div>
          <Field
            id="rate-source"
            label={t('source')}
            helper={t('sourceHelper')}
            error={fieldError('sourceRef')}
          >
            <Input name="sourceRef" maxLength={120} autoComplete="off" />
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
