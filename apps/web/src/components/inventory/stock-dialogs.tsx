'use client';

import type { HubDto, StockItemDto, StockMovementRowDto } from '@shakti/contracts';
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
import { adjustStock, reverseStock, transferStock } from '../../actions/inventory';
import { STOCK_ADJUSTMENTS } from '../../screens/contract-values';
import { formatQty, quantityFromTyped, serialsFromTyped } from '../../screens/inventory';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';
import { useBinKindText } from './use-inventory-text';

export type StockDialogKind = 'adjust' | 'move';

/** The hubs a person moves stock in by hand: godowns and factories in use, with their bins. */
function siteHubs(hubs: readonly HubDto[]): HubDto[] {
  return hubs
    .filter((h) => h.kind !== 'transit' && h.archivedAt === null)
    .map((h) => ({
      ...h,
      bins: h.bins.filter((b) => b.archivedAt === null && b.kind !== 'transit'),
    }))
    .filter((h) => h.bins.length > 0);
}

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

interface StockFormProps {
  entityId: number;
  item: StockItemDto;
  hubs: readonly HubDto[];
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: () => void;
}

/** A hub and one of its bins, or two for a move. */
function useBinChoice(hubs: readonly HubDto[]) {
  const sites = siteHubs(hubs);
  const [hubId, setHubId] = useState(sites[0]?.id ?? '');
  const hub = sites.find((h) => h.id === hubId);
  return { sites, hubId, setHubId, bins: hub?.bins ?? [] };
}

/** The quantity, or the serials of a tracked item, from the form; undefined when not valid. */
function readWhat(
  item: StockItemDto,
  data: FormData,
): { qty: string } | { serialNos: string[] } | undefined {
  if (item.isSerialTracked) {
    const serialNos = serialsFromTyped(formText(data, 'serialNos'));
    return serialNos === undefined ? undefined : { serialNos };
  }
  const qty = quantityFromTyped(formText(data, 'qty'));
  return qty === undefined ? undefined : { qty };
}

function WhatField({ item, error }: { item: StockItemDto; error: ReactNode }) {
  const t = useTranslations('inventory.dialogs');
  return item.isSerialTracked ? (
    <Field id="stock-serials" label={t('serials')} helper={t('serialsHelper')} error={error}>
      <Textarea name="serialNos" rows={4} autoComplete="off" spellCheck={false} />
    </Field>
  ) : (
    <Field id="stock-qty" label={t('qty')} helper={t('qtyHelper')} error={error}>
      <Input name="qty" inputMode="decimal" autoComplete="off" maxLength={14} />
    </Field>
  );
}

/** Adjust stock: a gain, loss or damage in one bin, with why. */
export function AdjustDialog({
  entityId,
  item,
  hubs,
  returnFocusTo,
  onClose,
  onSaved,
}: StockFormProps) {
  const t = useTranslations('inventory.dialogs');
  const common = useTranslations('common');
  const binKind = useBinKindText();
  const { sites, hubId, setHubId, bins } = useBinChoice(hubs);
  const { run, pending, failure } = useCommand(adjustStock);
  const { fieldError, formFailure } = useFieldFailure(failure, ['qty', 'serialNos', 'note']);
  const [problem, setProblem] = useState<'what' | 'note' | 'bin' | undefined>();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const what = readWhat(item, data);
    const note = formText(data, 'note');
    const binId = formText(data, 'bin');
    if (binId === '') {
      setProblem('bin');
      return;
    }
    if (what === undefined) {
      setProblem('what');
      return;
    }
    if (note.length < 3 || note.length > 300) {
      setProblem('note');
      return;
    }
    setProblem(undefined);
    run(
      {
        entityId,
        itemId: item.id,
        binId,
        adjustment: formText(data, 'adjustment'),
        note,
        ...what,
      },
      () => {
        toast.success(t('adjusted'));
        onSaved();
      },
    );
  }

  return (
    <Frame returnFocusTo={returnFocusTo} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('adjustTitle', { name: item.name })}</DialogTitle>
          <DialogDescription>{t('adjustIntro')}</DialogDescription>
        </DialogHeader>
        <Field id="stock-adjustment" label={t('adjustment')}>
          <Select name="adjustment" defaultValue="gain">
            {STOCK_ADJUSTMENTS.map((a) => (
              <option key={a} value={a}>
                {t(`adjustments.${a}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="stock-adjust-hub" label={t('hub')}>
          <Select
            value={hubId}
            onChange={(e) => {
              setHubId(e.currentTarget.value);
            }}
          >
            {sites.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="stock-adjust-bin"
          label={t('bin')}
          error={problem === 'bin' ? t('binMissing') : undefined}
        >
          <Select name="bin" key={hubId}>
            {bins.map((b) => (
              <option key={b.id} value={b.id}>
                {t('binOption', { bin: b.code, kind: binKind(b.kind) })}
              </option>
            ))}
          </Select>
        </Field>
        <WhatField
          item={item}
          error={
            problem === 'what'
              ? item.isSerialTracked
                ? t('serialsInvalid')
                : t('qtyInvalid')
              : (fieldError('qty') ?? fieldError('serialNos'))
          }
        />
        <Field
          id="stock-adjust-note"
          label={t('note')}
          helper={t('noteHelper')}
          error={problem === 'note' ? t('noteInvalid') : fieldError('note')}
        >
          <Textarea name="note" rows={3} maxLength={300} />
        </Field>
        <FailureMessage failure={formFailure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button type="submit" pending={pending}>
            {t('adjustSubmit')}
          </Button>
        </DialogFooter>
      </form>
    </Frame>
  );
}

/** Move between bins: from one bin of a hub to another bin of the same hub. */
export function MoveDialog({
  entityId,
  item,
  hubs,
  returnFocusTo,
  onClose,
  onSaved,
}: StockFormProps) {
  const t = useTranslations('inventory.dialogs');
  const common = useTranslations('common');
  const binKind = useBinKindText();
  const { sites, hubId, setHubId, bins } = useBinChoice(hubs);
  const { run, pending, failure } = useCommand(transferStock);
  const { fieldError, formFailure } = useFieldFailure(failure, ['qty', 'serialNos', 'toBinId']);
  const [problem, setProblem] = useState<'what' | 'same' | undefined>();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const what = readWhat(item, data);
    const fromBinId = formText(data, 'from');
    const toBinId = formText(data, 'to');
    if (fromBinId === '' || fromBinId === toBinId) {
      setProblem('same');
      return;
    }
    if (what === undefined) {
      setProblem('what');
      return;
    }
    setProblem(undefined);
    run({ entityId, itemId: item.id, fromBinId, toBinId, ...what }, () => {
      toast.success(t('moved'));
      onSaved();
    });
  }

  const options = bins.map((b) => (
    <option key={b.id} value={b.id}>
      {t('binOption', { bin: b.code, kind: binKind(b.kind) })}
    </option>
  ));
  return (
    <Frame returnFocusTo={returnFocusTo} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('moveTitle', { name: item.name })}</DialogTitle>
          <DialogDescription>{t('moveIntro')}</DialogDescription>
        </DialogHeader>
        <Field id="stock-move-hub" label={t('hub')}>
          <Select
            value={hubId}
            onChange={(e) => {
              setHubId(e.currentTarget.value);
            }}
          >
            {sites.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="stock-move-from" label={t('fromBin')}>
          <Select name="from" key={`from-${hubId}`}>
            {options}
          </Select>
        </Field>
        <Field
          id="stock-move-to"
          label={t('toBin')}
          error={problem === 'same' ? t('sameBin') : fieldError('toBinId')}
        >
          <Select name="to" key={`to-${hubId}`} defaultValue={bins[1]?.id ?? bins[0]?.id}>
            {options}
          </Select>
        </Field>
        <WhatField
          item={item}
          error={
            problem === 'what'
              ? item.isSerialTracked
                ? t('serialsInvalid')
                : t('qtyInvalid')
              : (fieldError('qty') ?? fieldError('serialNos'))
          }
        />
        <FailureMessage failure={formFailure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button type="submit" pending={pending}>
            {t('moveSubmit')}
          </Button>
        </DialogFooter>
      </form>
    </Frame>
  );
}

/** Reverse a movement made in error, with an optional reason. */
export function ReverseDialog({
  entityId,
  movement,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  entityId: number;
  movement: StockMovementRowDto;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('inventory.dialogs');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(reverseStock);
  const { fieldError, formFailure } = useFieldFailure(failure, ['note']);
  const [problem, setProblem] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const note = formText(new FormData(e.currentTarget), 'note');
    if (note !== '' && (note.length < 3 || note.length > 300)) {
      setProblem(true);
      return;
    }
    setProblem(false);
    run({ entityId, movementId: movement.id, ...(note === '' ? {} : { note }) }, () => {
      toast.success(t('reversed'));
      onSaved();
    });
  }

  return (
    <Frame returnFocusTo={returnFocusTo} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('reverseTitle')}</DialogTitle>
          <DialogDescription>
            {t('reverseIntro', { qty: formatQty(movement.qty) })}
          </DialogDescription>
        </DialogHeader>
        <Field
          id="stock-reverse-note"
          label={t('reverseNote')}
          helper={t('noteHelper')}
          error={problem ? t('noteInvalid') : fieldError('note')}
        >
          <Textarea name="note" rows={3} maxLength={300} />
        </Field>
        <FailureMessage failure={formFailure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button type="submit" variant="danger" pending={pending}>
            {t('reverseSubmit')}
          </Button>
        </DialogFooter>
      </form>
    </Frame>
  );
}
