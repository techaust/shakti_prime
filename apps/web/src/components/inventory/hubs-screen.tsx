'use client';

import type { BinDto, HubDto, HubListDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  toast,
  type DataGridColumn,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  archiveBin,
  archiveHub,
  createBin,
  createHub,
  listHubs,
  updateBin,
  updateHub,
} from '../../actions/inventory';
import { EDITABLE_BIN_KINDS, WAREHOUSE_KINDS } from '../../screens/contract-values';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';
import { LabelsDialog } from './labels-dialog';
import { useBinKindText, useHubKindText } from './use-inventory-text';

type Open =
  | { kind: 'hub'; hub: HubDto | undefined }
  | { kind: 'bin'; hub: HubDto; bin: BinDto | undefined }
  | { kind: 'archiveHub'; hub: HubDto }
  | { kind: 'archiveBin'; bin: BinDto }
  // Q1 labels
  | { kind: 'printHub'; hub: HubDto; bins: BinDto[] }
  | { kind: 'reprintBin'; hub: HubDto; bin: BinDto };

/** Bins that carry a label: every bin of a godown or factory; a transit bin is no place on a rack. */
const labelled = (hub: HubDto) => hub.bins.filter((b) => b.kind !== 'transit');

/**
 * `/inventory/hubs` (docs/03-roadmap-appendix/phase3.md §5): the group's hubs and their bins. An
 * Executive (`inventory.stock.adjust` for every company) adds and edits hubs and bins and
 * archives one that holds no stock; everyone else reads them. A stock handler
 * (`inventory.stock.move` for the company, Q1) prints a hub's bin labels and a bin's again.
 */
export function HubsScreen({
  initial,
  canEdit,
  labelsFor,
}: {
  initial: HubListDto;
  canEdit: boolean;
  /** The company labels are printed in, when the caller may print them. */
  labelsFor: number | null;
}) {
  const t = useTranslations('inventory.hubs');
  const labels = useTranslations('inventory.labels');
  const hubKind = useHubKindText();
  const binKind = useBinKindText();
  const [hubs, setHubs] = useState(initial.hubs);
  const [open, setOpen] = useState<{ what: Open; returnFocusTo: ReturnFocusTo } | undefined>();
  const { load, failure } = useQuery<HubListDto>();
  const addButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  function reload() {
    load(
      () => listHubs({}),
      (list) => {
        setHubs(list.hubs);
      },
    );
  }

  const ask = (what: Open, button: HTMLButtonElement | null) => {
    opener.current = button;
    setOpen({ what, returnFocusTo: () => [opener.current, addButton.current] });
  };
  const close = () => {
    setOpen(undefined);
  };
  const saved = () => {
    setOpen(undefined);
    reload();
  };

  const binColumns = (hub: HubDto): DataGridColumn<BinDto>[] => {
    const columns: DataGridColumn<BinDto>[] = [
      { id: 'code', header: t('columns.bin'), primary: true, cell: (b) => b.code },
      { id: 'kind', header: t('columns.kind'), cell: (b) => binKind(b.kind) },
    ];
    if (canEdit || labelsFor !== null) {
      columns.push({
        id: 'actions',
        header: <span className="sr-only">{t('columns.actions')}</span>,
        align: 'end',
        cell: (b) =>
          b.kind === 'transit' ? null : (
            <span className="flex justify-end gap-2">
              {labelsFor === null ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    ask({ kind: 'reprintBin', hub, bin: b }, e.currentTarget);
                  }}
                >
                  {labels('newLabel', { bin: b.code })}
                </Button>
              )}
              {canEdit ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    ask({ kind: 'bin', hub, bin: b }, e.currentTarget);
                  }}
                >
                  {t('editBin', { bin: b.code })}
                </Button>
              ) : null}
              {!canEdit || b.kind === 'receiving' || b.kind === 'dispatch' ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    ask({ kind: 'archiveBin', bin: b }, e.currentTarget);
                  }}
                >
                  {t('archiveBin', { bin: b.code })}
                </Button>
              )}
            </span>
          ),
      });
    }
    return columns;
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {canEdit ? (
        <div>
          <Button
            ref={addButton}
            onClick={(e) => {
              ask({ kind: 'hub', hub: undefined }, e.currentTarget);
            }}
          >
            {t('addHub')}
          </Button>
        </div>
      ) : null}
      <FailureMessage failure={failure} />
      {hubs.length === 0 ? <EmptyState message={t('empty')} /> : null}
      {hubs.map((hub) => (
        <section
          key={hub.id}
          className="border-border flex flex-col gap-3 rounded-lg border p-4"
          aria-labelledby={`hub-${hub.id}`}
        >
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex min-w-0 grow flex-col">
              <h2 id={`hub-${hub.id}`} className="text-lg font-semibold">
                {t('hubTitle', { name: hub.name, code: hub.code })}
              </h2>
              <span className="text-text-muted text-sm">
                {hub.address === null
                  ? hubKind(hub.kind)
                  : t('hubLine', { kind: hubKind(hub.kind), address: hub.address })}
              </span>
            </div>
            {labelsFor === null || labelled(hub).length === 0 ? null : (
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  ask({ kind: 'printHub', hub, bins: labelled(hub) }, e.currentTarget);
                }}
              >
                {labels('printLabels', { name: hub.name })}
              </Button>
            )}
            {canEdit ? (
              <span className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    ask({ kind: 'hub', hub }, e.currentTarget);
                  }}
                >
                  {t('editHub', { name: hub.name })}
                </Button>
                {hub.kind === 'transit' ? null : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      ask({ kind: 'bin', hub, bin: undefined }, e.currentTarget);
                    }}
                  >
                    {t('addBin', { name: hub.name })}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    ask({ kind: 'archiveHub', hub }, e.currentTarget);
                  }}
                >
                  {t('archiveHub', { name: hub.name })}
                </Button>
              </span>
            ) : null}
          </div>
          <DataGrid
            caption={t('binsCaption', { name: hub.name })}
            columns={binColumns(hub)}
            rows={hub.bins}
            rowKey={(b) => b.id}
            empty={<EmptyState message={t('noBins')} />}
          />
        </section>
      ))}
      {open === undefined || labelsFor === null ? null : open.what.kind === 'printHub' ? (
        <LabelsDialog
          mode="print"
          entityId={labelsFor}
          labelKind="bin"
          ids={open.what.bins.map((b) => b.id)}
          title={labels('printHubTitle', { name: open.what.hub.name })}
          intro={labels('printHubIntro', { count: open.what.bins.length })}
          returnFocusTo={open.returnFocusTo}
          onClose={close}
        />
      ) : open.what.kind === 'reprintBin' ? (
        <LabelsDialog
          mode="reprint"
          entityId={labelsFor}
          labelKind="bin"
          ids={[open.what.bin.id]}
          title={labels('reprintBinTitle', { bin: open.what.bin.code })}
          intro={labels('reprintBinIntro', { hub: open.what.hub.name })}
          returnFocusTo={open.returnFocusTo}
          onClose={close}
        />
      ) : null}
      {open === undefined ||
      open.what.kind === 'printHub' ||
      open.what.kind === 'reprintBin' ? null : (
        <Frame returnFocusTo={open.returnFocusTo} onClose={close}>
          {open.what.kind === 'hub' ? (
            <HubForm hub={open.what.hub} onClose={close} onSaved={saved} />
          ) : open.what.kind === 'bin' ? (
            <BinForm hub={open.what.hub} bin={open.what.bin} onClose={close} onSaved={saved} />
          ) : open.what.kind === 'archiveHub' ? (
            <ArchiveForm
              title={t('archiveHubTitle', { name: open.what.hub.name })}
              intro={t('archiveHubIntro')}
              id={open.what.hub.id}
              kind="hub"
              onClose={close}
              onSaved={saved}
            />
          ) : (
            <ArchiveForm
              title={t('archiveBinTitle', { bin: open.what.bin.code })}
              intro={t('archiveBinIntro')}
              id={open.what.bin.id}
              kind="bin"
              onClose={close}
              onSaved={saved}
            />
          )}
        </Frame>
      )}
    </div>
  );
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

const STATE = /^[0-9]{2}$/;
const PIN = /^[1-9][0-9]{5}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

function HubForm({
  hub,
  onClose,
  onSaved,
}: {
  hub: HubDto | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('inventory.hubs.form');
  const common = useTranslations('common');
  const hubKind = useHubKindText();
  const create = useCommand(createHub);
  const update = useCommand(updateHub);
  const { pending, failure } = hub === undefined ? create : update;
  const { fieldError, formFailure } = useFieldFailure(failure, ['code', 'name', 'pinCode']);
  const [kind, setKind] = useState<string>(hub?.kind ?? 'godown');
  const [problem, setProblem] = useState<'code' | 'name' | 'state' | 'pin' | undefined>();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const code = formText(data, 'code');
    const name = formText(data, 'name');
    const address = formText(data, 'address');
    const stateCode = formText(data, 'stateCode');
    const pinCode = formText(data, 'pinCode');
    const site = kind !== 'transit';
    if (!CODE.test(code) || code.length > 20) {
      setProblem('code');
      return;
    }
    if (name.length < 2 || name.length > 80) {
      setProblem('name');
      return;
    }
    if ((site || stateCode !== '') && !STATE.test(stateCode)) {
      setProblem('state');
      return;
    }
    if ((site || pinCode !== '') && !PIN.test(pinCode)) {
      setProblem('pin');
      return;
    }
    setProblem(undefined);
    const fields = {
      code,
      name,
      address: address === '' ? null : address,
      stateCode: stateCode === '' ? null : stateCode,
      pinCode: pinCode === '' ? null : pinCode,
    };
    const done = () => {
      toast.success(t('saved'));
      onSaved();
    };
    if (hub === undefined) create.run({ ...fields, kind }, done);
    else update.run({ ...fields, hubId: hub.id }, done);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          {hub === undefined ? t('addTitle') : t('editTitle', { name: hub.name })}
        </DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      {hub === undefined ? (
        <Field id="hub-kind" label={t('kind')} helper={t('kindHelper')}>
          <Select
            name="kind"
            value={kind}
            onChange={(e) => {
              setKind(e.currentTarget.value);
            }}
          >
            {WAREHOUSE_KINDS.map((k) => (
              <option key={k} value={k}>
                {hubKind(k)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field
        id="hub-code"
        label={t('code')}
        helper={t('codeHelper')}
        error={problem === 'code' ? t('codeInvalid') : fieldError('code')}
      >
        <Input name="code" maxLength={20} autoComplete="off" defaultValue={hub?.code ?? ''} />
      </Field>
      <Field
        id="hub-name"
        label={t('name')}
        error={problem === 'name' ? t('nameInvalid') : fieldError('name')}
      >
        <Input name="name" maxLength={80} defaultValue={hub?.name ?? ''} />
      </Field>
      <Field id="hub-address" label={t('address')}>
        <Input name="address" maxLength={300} defaultValue={hub?.address ?? ''} />
      </Field>
      <Field
        id="hub-state"
        label={t('stateCode')}
        helper={t('stateCodeHelper')}
        error={problem === 'state' ? t('stateCodeInvalid') : undefined}
      >
        <Input
          name="stateCode"
          inputMode="numeric"
          maxLength={2}
          autoComplete="off"
          defaultValue={hub?.stateCode ?? ''}
        />
      </Field>
      <Field
        id="hub-pin"
        label={t('pinCode')}
        error={problem === 'pin' ? t('pinCodeInvalid') : fieldError('pinCode')}
      >
        <Input
          name="pinCode"
          inputMode="numeric"
          maxLength={6}
          autoComplete="postal-code"
          defaultValue={hub?.pinCode ?? ''}
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
  );
}

function BinForm({
  hub,
  bin,
  onClose,
  onSaved,
}: {
  hub: HubDto;
  bin: BinDto | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('inventory.hubs.binForm');
  const common = useTranslations('common');
  const binKind = useBinKindText();
  const create = useCommand(createBin);
  const update = useCommand(updateBin);
  const { pending, failure } = bin === undefined ? create : update;
  const { fieldError, formFailure } = useFieldFailure(failure, ['code', 'kind']);
  const [problem, setProblem] = useState(false);
  const editableKind =
    bin === undefined || (EDITABLE_BIN_KINDS as readonly string[]).includes(bin.kind);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const code = formText(data, 'code');
    if (!CODE.test(code) || code.length > 41) {
      setProblem(true);
      return;
    }
    setProblem(false);
    const kind = formText(data, 'kind');
    const done = () => {
      toast.success(t('saved'));
      onSaved();
    };
    if (bin === undefined) create.run({ hubId: hub.id, code, kind }, done);
    else update.run({ binId: bin.id, code, ...(editableKind ? { kind } : {}) }, done);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          {bin === undefined
            ? t('addTitle', { name: hub.name })
            : t('editTitle', { bin: bin.code })}
        </DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="bin-code"
        label={t('code')}
        helper={t('codeHelper')}
        error={problem ? t('codeInvalid') : fieldError('code')}
      >
        <Input name="code" maxLength={41} autoComplete="off" defaultValue={bin?.code ?? ''} />
      </Field>
      {editableKind ? (
        <Field id="bin-kind" label={t('kind')} error={fieldError('kind')}>
          <Select name="kind" defaultValue={bin?.kind ?? 'storage'}>
            {EDITABLE_BIN_KINDS.map((k) => (
              <option key={k} value={k}>
                {binKind(k)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
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
  );
}

function ArchiveForm({
  title,
  intro,
  id,
  kind,
  onClose,
  onSaved,
}: {
  title: string;
  intro: string;
  id: string;
  kind: 'hub' | 'bin';
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('inventory.hubs');
  const common = useTranslations('common');
  const hub = useCommand(archiveHub);
  const bin = useCommand(archiveBin);
  const { pending, failure } = kind === 'hub' ? hub : bin;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const done = () => {
      toast.success(t('archived'));
      onSaved();
    };
    if (kind === 'hub') hub.run({ hubId: id }, done);
    else bin.run({ binId: id }, done);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{intro}</DialogDescription>
      </DialogHeader>
      <FailureMessage failure={failure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          {common('cancel')}
        </Button>
        <Button type="submit" variant="danger" pending={pending}>
          {t('archiveSubmit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
