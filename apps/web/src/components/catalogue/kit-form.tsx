'use client';

import type { KitDetailDto } from '@shakti/contracts';
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
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { createKit, updateKit } from '../../actions/catalogue';
import { kitQuantity } from '../../screens/catalogue';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';
import { ItemPicker } from './item-picker';
import { useCatalogueText } from './use-spec-text';

const FIELDS = ['sku', 'name'] as const;

interface Line {
  itemId: string;
  name: string;
  sku: string;
  unit: string;
  qty: string;
}

/** Adds a kit, or edits one: its code, name and items with their quantities, saved as a set. */
export function KitFormDialog({
  kit,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  kit?: KitDetailDto;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: (kit: KitDetailDto) => void;
}) {
  const t = useTranslations('catalogue.kitForm');
  const common = useTranslations('common');
  const text = useCatalogueText();
  const create = useCommand(createKit);
  const update = useCommand(updateKit);
  const { pending, failure } = kit === undefined ? create : update;
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);
  const [lines, setLines] = useState<Line[]>(
    () =>
      kit?.components
        .filter((c) => c.itemActive)
        .map((c) => ({ itemId: c.itemId, name: c.name, sku: c.sku, unit: c.unit, qty: c.qty })) ??
      [],
  );
  const [linesWrong, setLinesWrong] = useState<'noComponents' | 'quantityWrong' | undefined>();
  const linesProblemId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    if (lines.length === 0) {
      setLinesWrong('noComponents');
      return;
    }
    const components = lines.map((l) => ({ itemId: l.itemId, qty: kitQuantity(l.qty) }));
    if (components.some((c) => c.qty === undefined)) {
      setLinesWrong('quantityWrong');
      return;
    }
    setLinesWrong(undefined);
    const input = {
      sku: formText(data, 'sku'),
      name: formText(data, 'name'),
      components: components.map((c) => ({ itemId: c.itemId, qty: c.qty ?? '' })),
    };
    const done = (saved: KitDetailDto) => {
      toast.success(
        kit === undefined ? t('created', { name: saved.name }) : t('saved', { name: saved.name }),
      );
      onSaved(saved);
    };
    if (kit === undefined) create.run(input, done);
    else update.run({ kitId: kit.id, ...input }, done);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        closeLabel={common('close')}
        returnFocusTo={returnFocusTo}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              {kit === undefined ? t('createTitle') : t('editTitle', { name: kit.name })}
            </DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          <Field id="kit-sku" label={t('sku')} helper={t('skuHelper')} error={fieldError('sku')}>
            <Input
              name="sku"
              required
              maxLength={40}
              autoComplete="off"
              autoCapitalize="characters"
              defaultValue={kit?.sku ?? ''}
            />
          </Field>
          <Field
            id="kit-name"
            label={t('name')}
            helper={t('nameHelper')}
            error={fieldError('name')}
          >
            <Input
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              defaultValue={kit?.name ?? ''}
            />
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-h3 mb-2">{t('componentsHeading')}</legend>
            {lines.length === 0 ? null : (
              <ul className="flex flex-col gap-2">
                {lines.map((l) => (
                  <li
                    key={l.itemId}
                    className="border-border flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words">{l.name}</span>
                      <span className="text-text-muted block text-sm">
                        {l.sku} · {text.unit(l.unit)}
                      </span>
                    </span>
                    <Input
                      aria-label={t('quantity', { name: l.name })}
                      aria-describedby={linesWrong === undefined ? undefined : linesProblemId}
                      inputMode="decimal"
                      autoComplete="off"
                      value={l.qty}
                      className="w-24 tabular-nums"
                      onChange={(e) => {
                        const qty = e.currentTarget.value;
                        setLines((all) =>
                          all.map((x) => (x.itemId === l.itemId ? { ...x, qty } : x)),
                        );
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('removeItem', { name: l.name })}
                      onClick={() => {
                        setLines((all) => all.filter((x) => x.itemId !== l.itemId));
                        pickerRef.current?.querySelector('input')?.focus();
                      }}
                    >
                      {t('remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {linesWrong === undefined ? null : (
              <p id={linesProblemId} role="alert" className="text-danger">
                {t(linesWrong)}
              </p>
            )}
            <div ref={pickerRef}>
              <ItemPicker
                id="kit-find-item"
                label={t('find')}
                helper={t('findHelper')}
                noneFound={t('noneFound')}
                chooseLabel={t('add')}
                chooseFor={(item) => t('addItem', { name: item.name })}
                exclude={lines.map((l) => l.itemId)}
                onChoose={(item) => {
                  setLines((all) => [
                    ...all,
                    { itemId: item.id, name: item.name, sku: item.sku, unit: item.unit, qty: '1' },
                  ]);
                  setLinesWrong(undefined);
                }}
              />
            </div>
          </fieldset>
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
