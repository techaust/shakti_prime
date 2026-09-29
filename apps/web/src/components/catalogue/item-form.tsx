'use client';

import type { ItemCategory, ItemDetailDto, ItemUnit, SpecField } from '@shakti/contracts';
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
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { createItem, updateItem } from '../../actions/catalogue';
import { specNumber } from '../../screens/catalogue';
import { ITEM_CATEGORIES, ITEM_SPEC_FIELDS, ITEM_UNITS } from '../../screens/contract-values';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';
import { useCatalogueText } from './use-spec-text';

const FIELDS = ['sku', 'name', 'category', 'hsn', 'unit', 'almmRef'] as const;

/**
 * Adds an item, or edits one: its code, name, category, HSN code and unit, and the
 * specifications of its category. A solar module also records its DCR mark and ALMM listing.
 */
export function ItemFormDialog({
  item,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  item?: ItemDetailDto;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: (item: ItemDetailDto) => void;
}) {
  const t = useTranslations('catalogue.itemForm');
  const common = useTranslations('common');
  const text = useCatalogueText();
  const create = useCommand(createItem);
  const update = useCommand(updateItem);
  const { pending, failure } = item === undefined ? create : update;
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);
  const [category, setCategory] = useState<ItemCategory>(item?.category ?? 'pump');
  const [specProblems, setSpecProblems] = useState<Record<string, string>>({});

  const fields = ITEM_SPEC_FIELDS[category];

  function readSpecs(data: FormData): Record<string, number | string> | undefined {
    const specs: Record<string, number | string> = {};
    const problems: Record<string, string> = {};
    for (const f of fields) {
      const typed = formText(data, `spec-${f.key}`);
      const problem = specProblem(f, typed, specs);
      if (problem !== undefined) problems[f.key] = problem;
    }
    setSpecProblems(problems);
    return Object.keys(problems).length === 0 ? specs : undefined;
  }

  function specProblem(
    f: SpecField,
    typed: string,
    specs: Record<string, number | string>,
  ): string | undefined {
    if (f.kind === 'number') {
      const value = specNumber(typed, f);
      if (value === undefined) {
        return t('numberWrong', { min: f.min, max: f.max, decimals: f.decimals });
      }
      specs[f.key] = value;
      return undefined;
    }
    if (f.kind === 'choice') {
      if (!f.options.includes(typed)) return t('choiceWrong');
      specs[f.key] = typed;
      return undefined;
    }
    const trimmed = typed.trim();
    if (trimmed.length === 0 || trimmed.length > f.maxLength) {
      return t('textWrong', { max: f.maxLength });
    }
    specs[f.key] = trimmed;
    return undefined;
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const specs = readSpecs(data);
    if (specs === undefined) return;
    const solar = category === 'solar_module';
    const almmRef = formText(data, 'almmRef').trim();
    const input = {
      sku: formText(data, 'sku'),
      name: formText(data, 'name'),
      category,
      hsn: formText(data, 'hsn').trim(),
      unit: formText(data, 'unit') as ItemUnit,
      isSerialTracked: data.get('isSerialTracked') === 'on',
      isDcr: solar && data.get('isDcr') === 'on',
      ...(solar && almmRef !== '' ? { almmRef } : {}),
      specs,
    };
    const done = (saved: ItemDetailDto) => {
      toast.success(
        item === undefined ? t('created', { name: saved.name }) : t('saved', { name: saved.name }),
      );
      onSaved(saved);
    };
    if (item === undefined) create.run(input, done);
    else update.run({ itemId: item.id, ...input }, done);
  }

  const specValue = (key: string) => {
    const value = item?.category === category ? item.specs[key] : undefined;
    return value === undefined ? '' : String(value);
  };

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
              {item === undefined ? t('createTitle') : t('editTitle', { name: item.name })}
            </DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          <Field id="item-sku" label={t('sku')} helper={t('skuHelper')} error={fieldError('sku')}>
            <Input
              name="sku"
              required
              maxLength={40}
              autoComplete="off"
              autoCapitalize="characters"
              defaultValue={item?.sku ?? ''}
            />
          </Field>
          <Field
            id="item-name"
            label={t('name')}
            helper={t('nameHelper')}
            error={fieldError('name')}
          >
            <Input
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              defaultValue={item?.name ?? ''}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="item-category" label={t('category')} error={fieldError('category')}>
              <Select
                name="category"
                value={category}
                onChange={(e) => {
                  setCategory(e.currentTarget.value as ItemCategory);
                  setSpecProblems({});
                }}
              >
                {ITEM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {text.category(c)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="item-unit" label={t('unit')} error={fieldError('unit')}>
              <Select name="unit" defaultValue={item?.unit ?? 'nos'}>
                {ITEM_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {text.unit(u)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id="item-hsn" label={t('hsn')} helper={t('hsnHelper')} error={fieldError('hsn')}>
            <Input
              name="hsn"
              required
              inputMode="numeric"
              maxLength={8}
              autoComplete="off"
              defaultValue={item?.hsn ?? ''}
              className="tabular-nums"
            />
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="isSerialTracked"
              className="accent-accent size-4"
              defaultChecked={item?.isSerialTracked ?? false}
            />
            {t('serial')}
          </label>
          {category === 'solar_module' ? (
            <>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="isDcr"
                  className="accent-accent size-4"
                  defaultChecked={item?.isDcr ?? false}
                />
                {t('dcr')}
              </label>
              <Field
                id="item-almm"
                label={t('almm')}
                helper={t('almmHelper')}
                error={fieldError('almmRef')}
              >
                <Input
                  name="almmRef"
                  maxLength={60}
                  autoComplete="off"
                  defaultValue={item?.almmRef ?? ''}
                />
              </Field>
            </>
          ) : null}
          <fieldset className="flex flex-col gap-4">
            <legend className="text-h3 mb-2">{t('specsHeading')}</legend>
            {fields.length === 0 ? <p className="text-text-muted">{t('noSpecs')}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <Field
                  key={`${category}-${f.key}`}
                  id={`item-spec-${f.key}`}
                  label={text.specLabel(f.key)}
                  helper={
                    f.kind === 'number' ? t('numberHelper', { min: f.min, max: f.max }) : undefined
                  }
                  error={specProblems[f.key]}
                >
                  {f.kind === 'choice' ? (
                    <Select name={`spec-${f.key}`} defaultValue={specValue(f.key)}>
                      <option value="">{t('choose')}</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {text.specValue(f.key, o)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      name={`spec-${f.key}`}
                      inputMode={f.kind === 'number' ? 'decimal' : 'text'}
                      maxLength={f.kind === 'text' ? f.maxLength : 12}
                      autoComplete="off"
                      defaultValue={specValue(f.key)}
                      className={f.kind === 'number' ? 'tabular-nums' : undefined}
                    />
                  )}
                </Field>
              ))}
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
