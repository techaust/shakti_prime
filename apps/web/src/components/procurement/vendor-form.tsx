'use client';

import type { VendorDto } from '@shakti/contracts';
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
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { createVendor, updateVendor } from '../../actions/procurement';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

const FIELDS = [
  'name',
  'gstin',
  'pan',
  'stateCode',
  'address',
  'paymentTermsDays',
  'leadTimeDays',
  'notes',
] as const;

/** A whole number of days as typed, or undefined when the box is empty; NaN when it is not one. */
function daysOf(typed: string): number | undefined {
  const value = typed.trim();
  if (value === '') return undefined;
  return /^\d{1,3}$/.test(value) ? Number(value) : Number.NaN;
}

/**
 * Adds a vendor of the group, or edits one: its name, GSTIN (which gives the state and the PAN),
 * the PAN of a supplier without GST registration, its address, payment terms and delivery time.
 */
export function VendorFormDialog({
  vendor,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  vendor?: VendorDto;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: (vendor: VendorDto) => void;
}) {
  const t = useTranslations('procurement.vendorForm');
  const common = useTranslations('common');
  const create = useCommand(createVendor);
  const update = useCommand(updateVendor);
  const { pending, failure } = vendor === undefined ? create : update;
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);
  const [daysWrong, setDaysWrong] = useState<'paymentTermsDays' | 'leadTimeDays' | undefined>();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const terms = daysOf(formText(data, 'paymentTermsDays'));
    const lead = daysOf(formText(data, 'leadTimeDays'));
    if (Number.isNaN(terms)) {
      setDaysWrong('paymentTermsDays');
      return;
    }
    if (Number.isNaN(lead)) {
      setDaysWrong('leadTimeDays');
      return;
    }
    setDaysWrong(undefined);
    const text = (name: string) => {
      const value = formText(data, name).trim();
      return value === '' ? undefined : value;
    };
    const gstin = text('gstin');
    const address = {
      ...(text('line1') === undefined ? {} : { line1: text('line1') }),
      ...(text('line2') === undefined ? {} : { line2: text('line2') }),
      ...(text('city') === undefined ? {} : { city: text('city') }),
      ...(text('pin') === undefined ? {} : { pin: text('pin') }),
    };
    const input = {
      name: formText(data, 'name'),
      gstin: gstin ?? null,
      // A registered vendor's PAN is read from its GSTIN.
      pan: gstin === undefined ? (text('pan') ?? null) : null,
      address,
      paymentTermsDays: terms ?? null,
      leadTimeDays: lead ?? null,
      notes: text('notes') ?? null,
    };
    const done = (saved: VendorDto) => {
      toast.success(
        vendor === undefined
          ? t('created', { name: saved.name })
          : t('saved', { name: saved.name }),
      );
      onSaved(saved);
    };
    if (vendor === undefined) create.run(input, done);
    else update.run({ vendorId: vendor.id, ...input }, done);
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
            <DialogTitle>
              {vendor === undefined ? t('createTitle') : t('editTitle', { name: vendor.name })}
            </DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          <Field id="vendor-name" label={t('name')} error={fieldError('name')}>
            <Input
              name="name"
              required
              maxLength={160}
              autoComplete="organization"
              defaultValue={vendor?.name ?? ''}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="vendor-gstin"
              label={t('gstin')}
              helper={t('gstinHelper')}
              error={fieldError('gstin') ?? fieldError('stateCode')}
            >
              <Input
                name="gstin"
                maxLength={15}
                autoComplete="off"
                autoCapitalize="characters"
                defaultValue={vendor?.gstin ?? ''}
              />
            </Field>
            <Field
              id="vendor-pan"
              label={t('pan')}
              helper={t('panHelper')}
              error={fieldError('pan')}
            >
              <Input
                name="pan"
                maxLength={10}
                autoComplete="off"
                autoCapitalize="characters"
                defaultValue={vendor?.gstin === null ? (vendor.pan ?? '') : ''}
              />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-4">
            <legend className="text-h3 mb-2">{t('addressHeading')}</legend>
            <Field id="vendor-line1" label={t('line1')} error={fieldError('address')}>
              <Input
                name="line1"
                maxLength={120}
                autoComplete="address-line1"
                defaultValue={vendor?.address.line1 ?? ''}
              />
            </Field>
            <Field id="vendor-line2" label={t('line2')}>
              <Input
                name="line2"
                maxLength={120}
                autoComplete="address-line2"
                defaultValue={vendor?.address.line2 ?? ''}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="vendor-city" label={t('city')}>
                <Input
                  name="city"
                  maxLength={80}
                  autoComplete="address-level2"
                  defaultValue={vendor?.address.city ?? ''}
                />
              </Field>
              <Field id="vendor-pin" label={t('pin')}>
                <Input
                  name="pin"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="postal-code"
                  defaultValue={vendor?.address.pin ?? ''}
                  className="tabular-nums"
                />
              </Field>
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="vendor-terms"
              label={t('paymentTerms')}
              helper={t('daysHelper')}
              error={
                daysWrong === 'paymentTermsDays' ? t('daysWrong') : fieldError('paymentTermsDays')
              }
            >
              <Input
                name="paymentTermsDays"
                inputMode="numeric"
                maxLength={3}
                autoComplete="off"
                defaultValue={vendor?.paymentTermsDays?.toString() ?? ''}
                className="tabular-nums"
              />
            </Field>
            <Field
              id="vendor-lead-time"
              label={t('leadTime')}
              helper={t('daysHelper')}
              error={daysWrong === 'leadTimeDays' ? t('daysWrong') : fieldError('leadTimeDays')}
            >
              <Input
                name="leadTimeDays"
                inputMode="numeric"
                maxLength={3}
                autoComplete="off"
                defaultValue={vendor?.leadTimeDays?.toString() ?? ''}
                className="tabular-nums"
              />
            </Field>
          </div>
          <Field id="vendor-notes" label={t('notes')} error={fieldError('notes')}>
            <Input
              name="notes"
              maxLength={2000}
              autoComplete="off"
              defaultValue={vendor?.notes ?? ''}
            />
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
