'use client';

import type {
  ClaimSerialDto,
  CustomerSiteDto,
  HubDto,
  VendorListRowDto,
  WarrantyClaimChangedDto,
} from '@shakti/contracts';
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
  Textarea,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  identifyWarrantySerial,
  raiseWarrantyClaim,
  raiseWarrantyRma,
  rejectWarrantyClaim,
  replaceWarranty,
  settleWarrantyClaim,
} from '../../actions/warranty';
import { formatDate, moneyFromTyped } from '../../screens/format';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/** A dialog of the warranty screens (R3), opened from a button and closed back to it. */
function Frame({
  returnFocusTo,
  onClose,
  children,
}: {
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  children: ReactNode;
}) {
  const common = useTranslations('common');
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function Footer({
  pending,
  submit,
  onClose,
}: {
  pending: boolean;
  submit: string;
  onClose: () => void;
}) {
  const common = useTranslations('common');
  return (
    <DialogFooter>
      <Button variant="secondary" onClick={onClose}>
        {common('cancel')}
      </Button>
      <Button type="submit" pending={pending}>
        {submit}
      </Button>
    </DialogFooter>
  );
}

interface DialogProps {
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: (claim: WarrantyClaimChangedDto) => void;
}

/**
 * Raise a warranty claim: from Account 360 on the customer (with the site, when they have one),
 * or from a serial's page on that serial, whose customer and site the claim takes.
 */
export function RaiseClaimDialog({
  entityId,
  on,
  returnFocusTo,
  onClose,
  onSaved,
}: DialogProps & {
  entityId: number;
  on:
    | { kind: 'customer'; accountId: string; sites: readonly CustomerSiteDto[] }
    | { kind: 'serial'; serialId: string; serialNo: string };
}) {
  const t = useTranslations('warranty.dialogs');
  const { run, pending, failure } = useCommand(raiseWarrantyClaim);
  const { fieldError, formFailure } = useFieldFailure(failure, ['reportedFault', 'siteId']);
  const [problem, setProblem] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const reportedFault = formText(data, 'reportedFault');
    if (reportedFault.length < 3 || reportedFault.length > 1000) {
      setProblem(true);
      return;
    }
    setProblem(false);
    const site = formText(data, 'siteId');
    run(
      on.kind === 'customer'
        ? { entityId, accountId: on.accountId, siteId: site === '' ? null : site, reportedFault }
        : { entityId, serialId: on.serialId, reportedFault },
      (claim) => {
        toast.success(t('raised', { claim: claim.claimNo }));
        onSaved(claim);
      },
    );
  }

  return (
    <Frame returnFocusTo={returnFocusTo} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('raiseTitle')}</DialogTitle>
          <DialogDescription>
            {on.kind === 'serial'
              ? t('raiseSerialIntro', { serial: on.serialNo })
              : t('raiseCustomerIntro')}
          </DialogDescription>
        </DialogHeader>
        {on.kind === 'customer' && on.sites.length > 0 ? (
          <Field id="claim-site" label={t('site')} error={fieldError('siteId')}>
            <Select name="siteId" defaultValue={on.sites.length === 1 ? on.sites[0]?.id : ''}>
              <option value="">{t('noSite')}</option>
              {on.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.village ?? t('siteWithoutVillage')}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field
          id="claim-fault"
          label={t('fault')}
          helper={t('faultHelper')}
          error={problem ? t('faultInvalid') : fieldError('reportedFault')}
        >
          <Textarea name="reportedFault" rows={4} maxLength={1000} />
        </Field>
        <FailureMessage failure={formFailure} />
        <Footer pending={pending} submit={t('raiseSubmit')} onClose={onClose} />
      </form>
    </Frame>
  );
}

/**
 * Identify the failed serial among the customer's delivered serials. One out of warranty is
 * refused, and the refusal names the day its warranty ended.
 */
export function IdentifyDialog({
  entityId,
  claimId,
  serials,
  returnFocusTo,
  onClose,
  onSaved,
}: DialogProps & { entityId: number; claimId: string; serials: readonly ClaimSerialDto[] }) {
  const t = useTranslations('warranty.dialogs');
  const { run, pending, failure } = useCommand(identifyWarrantySerial);
  const free = serials.filter((s) => s.openClaimId === null || s.openClaimId === claimId);
  const [serialId, setSerialId] = useState(free[0]?.id ?? '');
  const chosen = free.find((s) => s.id === serialId);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || serialId === '') return;
    run({ entityId, claimId, serialId }, (claim) => {
      toast.success(t('identified'));
      onSaved(claim);
    });
  }

  const expired =
    failure?.error === 'warranty_expired'
      ? chosen?.warrantyUntil
        ? t('expiredOn', { date: formatDate(chosen.warrantyUntil) })
        : t('noWarrantyDate')
      : undefined;

  return (
    <Frame returnFocusTo={returnFocusTo} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('identifyTitle')}</DialogTitle>
          <DialogDescription>{t('identifyIntro')}</DialogDescription>
        </DialogHeader>
        {free.length === 0 ? (
          <p>{t('noSerials')}</p>
        ) : (
          <Field
            id="claim-serial"
            label={t('serial')}
            helper={
              chosen?.warrantyUntil
                ? t('warrantyUntil', { date: formatDate(chosen.warrantyUntil) })
                : t('noWarrantyDate')
            }
            error={expired}
          >
            <Select
              value={serialId}
              onChange={(e) => {
                setSerialId(e.currentTarget.value);
              }}
            >
              {free.map((s) => (
                <option key={s.id} value={s.id}>
                  {t('serialOption', { serial: s.serialNo, item: s.item.name })}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <FailureMessage failure={expired === undefined ? failure : undefined} />
        <Footer pending={pending} submit={t('identifySubmit')} onClose={onClose} />
      </form>
    </Frame>
  );
}

/** Reject a claim: out of warranty, or not a fault, with why. */
export function RejectDialog({
  entityId,
  claimId,
  returnFocusTo,
  onClose,
  onSaved,
}: DialogProps & { entityId: number; claimId: string }) {
  const t = useTranslations('warranty.dialogs');
  const { run, pending, failure } = useCommand(rejectWarrantyClaim);
  const { fieldError, formFailure } = useFieldFailure(failure, ['rejectedReason']);
  const [problem, setProblem] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const rejectedReason = formText(new FormData(e.currentTarget), 'rejectedReason');
    if (rejectedReason.length < 3 || rejectedReason.length > 300) {
      setProblem(true);
      return;
    }
    setProblem(false);
    run({ entityId, claimId, rejectedReason }, (claim) => {
      toast.success(t('rejected'));
      onSaved(claim);
    });
  }

  return (
    <Frame returnFocusTo={returnFocusTo} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('rejectTitle')}</DialogTitle>
          <DialogDescription>{t('rejectIntro')}</DialogDescription>
        </DialogHeader>
        <Field
          id="claim-reject-reason"
          label={t('rejectReason')}
          error={problem ? t('rejectReasonInvalid') : fieldError('rejectedReason')}
        >
          <Textarea name="rejectedReason" rows={3} maxLength={300} />
        </Field>
        <FailureMessage failure={formFailure} />
        <Footer pending={pending} submit={t('rejectSubmit')} onClose={onClose} />
      </form>
    </Frame>
  );
}

/**
 * Close the claim with the supplier's credit. The amount is kept with the claim's costs, which
 * only people who see costs can read; it is not shown back here.
 */
export function SettleDialog({
  entityId,
  claimId,
  returnFocusTo,
  onClose,
  onSaved,
}: DialogProps & { entityId: number; claimId: string }) {
  const t = useTranslations('warranty.dialogs');
  const { run, pending, failure } = useCommand(settleWarrantyClaim);
  const { fieldError, formFailure } = useFieldFailure(failure, ['creditAmount']);
  const [problem, setProblem] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const creditAmount = moneyFromTyped(formText(new FormData(e.currentTarget), 'creditAmount'));
    if (creditAmount === undefined || Number(creditAmount) <= 0) {
      setProblem(true);
      return;
    }
    setProblem(false);
    run({ entityId, claimId, settlement: 'credit', creditAmount }, (claim) => {
      toast.success(t('settled'));
      onSaved(claim);
    });
  }

  return (
    <Frame returnFocusTo={returnFocusTo} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('settleTitle')}</DialogTitle>
          <DialogDescription>{t('settleIntro')}</DialogDescription>
        </DialogHeader>
        <Field
          id="claim-credit"
          label={t('credit')}
          helper={t('creditHelper')}
          error={problem ? t('creditInvalid') : fieldError('creditAmount')}
        >
          <Input name="creditAmount" inputMode="decimal" autoComplete="off" maxLength={16} />
        </Field>
        <FailureMessage failure={formFailure} />
        <Footer pending={pending} submit={t('settleSubmit')} onClose={onClose} />
      </form>
    </Frame>
  );
}

/** The bins of godowns and factories in use, of one kind, each with its hub's name. */
function binsOf(hubs: readonly HubDto[], kind: 'storage' | 'quarantine') {
  return hubs
    .filter((h) => h.kind !== 'transit' && h.archivedAt === null)
    .flatMap((h) =>
      h.bins
        .filter((b) => b.kind === kind && b.archivedAt === null)
        .map((b) => ({ id: b.id, code: b.code, hub: h.name })),
    );
}

/**
 * Give a replacement of the same product from stock: a serial in a storage bin, by its number
 * (scanned or typed). When the faulty item has come back already, it goes into a quarantine bin
 * in the same step.
 */
export function ReplaceDialog({
  entityId,
  claimId,
  product,
  hubs,
  returnFocusTo,
  onClose,
  onSaved,
}: DialogProps & { entityId: number; claimId: string; product: string; hubs: readonly HubDto[] }) {
  const t = useTranslations('warranty.dialogs');
  const { run, pending, failure } = useCommand(replaceWarranty);
  const { fieldError, formFailure } = useFieldFailure(failure, [
    'replacementSerialNo',
    'fromBinId',
    'faultyBinId',
  ]);
  const storage = binsOf(hubs, 'storage');
  const quarantine = binsOf(hubs, 'quarantine');
  const [back, setBack] = useState(false);
  const [problem, setProblem] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const replacementSerialNo = formText(data, 'replacementSerialNo');
    if (replacementSerialNo === '' || replacementSerialNo.length > 100) {
      setProblem(true);
      return;
    }
    setProblem(false);
    const faultyBinId = formText(data, 'faultyBinId');
    run(
      {
        entityId,
        claimId,
        fromBinId: formText(data, 'fromBinId'),
        replacementSerialNo,
        ...(back && faultyBinId !== '' ? { faultyBinId } : {}),
      },
      (claim) => {
        toast.success(t('replaced'));
        onSaved(claim);
      },
    );
  }

  return (
    <Frame returnFocusTo={returnFocusTo} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('replaceTitle')}</DialogTitle>
          <DialogDescription>{t('replaceIntro', { product })}</DialogDescription>
        </DialogHeader>
        <Field id="claim-from-bin" label={t('fromBin')} error={fieldError('fromBinId')}>
          <Select name="fromBinId">
            {storage.map((b) => (
              <option key={b.id} value={b.id}>
                {t('binOption', { bin: b.code, hub: b.hub })}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="claim-replacement-serial"
          label={t('replacementSerial')}
          helper={t('replacementSerialHelper')}
          error={problem ? t('replacementSerialInvalid') : fieldError('replacementSerialNo')}
        >
          <Input name="replacementSerialNo" autoComplete="off" spellCheck={false} maxLength={100} />
        </Field>
        <Field id="claim-faulty-back" label={t('faultyBack')}>
          <Select
            value={back ? 'yes' : 'no'}
            onChange={(e) => {
              setBack(e.currentTarget.value === 'yes');
            }}
          >
            <option value="no">{t('faultyNotBack')}</option>
            <option value="yes">{t('faultyIsBack')}</option>
          </Select>
        </Field>
        {back ? (
          <Field id="claim-faulty-bin" label={t('quarantineBin')} error={fieldError('faultyBinId')}>
            <Select name="faultyBinId">
              {quarantine.map((b) => (
                <option key={b.id} value={b.id}>
                  {t('binOption', { bin: b.code, hub: b.hub })}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <FailureMessage failure={formFailure} />
        <Footer pending={pending} submit={t('replaceSubmit')} onClose={onClose} />
      </form>
    </Frame>
  );
}

/**
 * Send the faulty item to its supplier under their warranty, with their return reference. A
 * faulty item still with the customer comes back into a quarantine bin first.
 */
export function RmaDialog({
  entityId,
  claimId,
  vendors,
  hubs,
  faultyBack,
  returnFocusTo,
  onClose,
  onSaved,
}: DialogProps & {
  entityId: number;
  claimId: string;
  vendors: readonly VendorListRowDto[];
  hubs: readonly HubDto[];
  /** The faulty item is in quarantine already. */
  faultyBack: boolean;
}) {
  const t = useTranslations('warranty.dialogs');
  const { run, pending, failure } = useCommand(raiseWarrantyRma);
  const { fieldError, formFailure } = useFieldFailure(failure, [
    'vendorId',
    'supplierRmaRef',
    'faultyBinId',
  ]);
  const quarantine = binsOf(hubs, 'quarantine');
  const [problem, setProblem] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const supplierRmaRef = formText(data, 'supplierRmaRef');
    if (supplierRmaRef === '' || supplierRmaRef.length > 100) {
      setProblem(true);
      return;
    }
    setProblem(false);
    run(
      {
        entityId,
        claimId,
        vendorId: formText(data, 'vendorId'),
        supplierRmaRef,
        ...(faultyBack ? {} : { faultyBinId: formText(data, 'faultyBinId') }),
      },
      (claim) => {
        toast.success(t('rmaRaised'));
        onSaved(claim);
      },
    );
  }

  return (
    <Frame returnFocusTo={returnFocusTo} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('rmaTitle')}</DialogTitle>
          <DialogDescription>{t('rmaIntro')}</DialogDescription>
        </DialogHeader>
        <Field id="claim-vendor" label={t('supplier')} error={fieldError('vendorId')}>
          <Select name="vendorId">
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="claim-rma-ref"
          label={t('rmaRef')}
          helper={t('rmaRefHelper')}
          error={problem ? t('rmaRefInvalid') : fieldError('supplierRmaRef')}
        >
          <Input name="supplierRmaRef" autoComplete="off" maxLength={100} />
        </Field>
        {faultyBack ? null : (
          <Field
            id="claim-rma-bin"
            label={t('quarantineBin')}
            helper={t('quarantineBinHelper')}
            error={fieldError('faultyBinId')}
          >
            <Select name="faultyBinId">
              {quarantine.map((b) => (
                <option key={b.id} value={b.id}>
                  {t('binOption', { bin: b.code, hub: b.hub })}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <FailureMessage failure={formFailure} />
        <Footer pending={pending} submit={t('rmaSubmit')} onClose={onClose} />
      </form>
    </Frame>
  );
}
