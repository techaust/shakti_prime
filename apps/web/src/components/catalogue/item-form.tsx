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
import {
  BARCODE_MAX_LENGTH,
  ITEM_CATEGORIES,
  ITEM_SPEC_FIELDS,
  ITEM_UNITS,
  NON_STOCK_CATEGORIES,
  SERIAL_PATTERN_MAX,
  WARRANTY_MONTHS_MAX,
} from '../../screens/contract-values';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';
import { useCatalogueText } from './use-spec-text';

const FIELDS = [
  'sku',
  'name',
  'category',
  'hsn',
  'unit',
  'almmRef',
  'warrantyMonths',
  'supplierWarrantyMonths',
  'barcode',
  'purchaseUnit',
  'purchaseUnitFactor',
  'serialPattern',
  'isStocked',
] as const;

/** Whole months from 0 to 360 typed into a warranty field; null when blank; undefined when wrong. */
function typedMonths(typed: string): number | null | undefined {
  const plain = typed.trim();
  if (plain === '') return null;
  if (!/^\d{1,3}$/.test(plain)) return undefined;
  const months = Number(plain);
  return months <= WARRANTY_MONTHS_MAX ? months : undefined;
}

/** A purchase unit's factor typed with up to three decimals, at least 1; undefined when wrong. */
function typedFactor(typed: string): string | undefined {
  const plain = typed.trim().replaceAll(',', '');
  return /^\d{1,9}(\.\d{1,3})?$/.test(plain) && Number(plain) >= 1 ? plain : undefined;
}

/**
 * Adds an item, or edits one: its code, name, category, HSN code and unit, the specifications of
 * its category, and its stock and warranty terms (C5): the warranties, the supplier's barcode, the
 * unit it is bought in, the shape of its serial numbers, and whether an Other item is kept in
 * stock. A solar module also records its DCR mark and ALMM listing.
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
  const [stockProblems, setStockProblems] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState<ItemUnit>(item?.unit ?? 'nos');
  const [serialTracked, setSerialTracked] = useState(item?.isSerialTracked ?? false);
  const [purchaseUnit, setPurchaseUnit] = useState<ItemUnit | ''>(item?.purchaseUnit ?? '');
  const mayBeService = (NON_STOCK_CATEGORIES as readonly ItemCategory[]).includes(category);
  const needsFactor = purchaseUnit !== '' && purchaseUnit !== unit;

  const fields = ITEM_SPEC_FIELDS[category];

  function readSpecs(data: FormData): Record<string, number | string> | undefined {
    const specs: Record<string, number | string> = {};
    const problems: Record<string, string> = {};
    for (const f of fields) {
      const typed = formText(data, `spec-${f.key}`);
      // An optional specification left blank is simply not recorded.
      if (f.optional === true && typed.trim() === '') continue;
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

  /** The stock and warranty terms as the commands take them, or undefined after showing why not. */
  function readStock(data: FormData) {
    const problems: Record<string, string> = {};
    const warrantyMonths = typedMonths(formText(data, 'warrantyMonths'));
    const supplierWarrantyMonths = typedMonths(formText(data, 'supplierWarrantyMonths'));
    if (warrantyMonths === undefined) {
      problems.warrantyMonths = t('monthsWrong', { max: WARRANTY_MONTHS_MAX });
    }
    if (supplierWarrantyMonths === undefined) {
      problems.supplierWarrantyMonths = t('monthsWrong', { max: WARRANTY_MONTHS_MAX });
    }
    const factorTyped = formText(data, 'purchaseUnitFactor');
    const factor = needsFactor ? typedFactor(factorTyped) : undefined;
    if (needsFactor && factor === undefined) problems.purchaseUnitFactor = t('factorWrong');
    const barcode = formText(data, 'barcode').trim();
    const serialPattern = formText(data, 'serialPattern').trim();
    setStockProblems(problems);
    if (Object.keys(problems).length > 0) return undefined;
    return {
      warrantyMonths: warrantyMonths ?? null,
      supplierWarrantyMonths: supplierWarrantyMonths ?? null,
      barcode: barcode === '' ? null : barcode,
      purchaseUnit: purchaseUnit === '' ? null : purchaseUnit,
      purchaseUnitFactor: needsFactor ? (factor ?? null) : null,
      serialPattern: serialTracked && serialPattern !== '' ? serialPattern : null,
      isStocked: mayBeService && !serialTracked ? data.get('isStocked') === 'on' : true,
    };
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const specs = readSpecs(data);
    const stock = readStock(data);
    if (specs === undefined || stock === undefined) return;
    const solar = category === 'solar_module';
    const almmRef = formText(data, 'almmRef').trim();
    const input = {
      sku: formText(data, 'sku'),
      name: formText(data, 'name'),
      category,
      hsn: formText(data, 'hsn').trim(),
      unit,
      isSerialTracked: serialTracked,
      isDcr: solar && data.get('isDcr') === 'on',
      ...(solar && almmRef !== '' ? { almmRef } : {}),
      specs,
      ...stock,
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
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
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
              <Select
                name="unit"
                value={unit}
                onChange={(e) => {
                  setUnit(e.currentTarget.value as ItemUnit);
                }}
              >
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
              checked={serialTracked}
              onChange={(e) => {
                setSerialTracked(e.currentTarget.checked);
              }}
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
          <fieldset className="flex flex-col gap-4">
            <legend className="text-h3 mb-2">{t('stockHeading')}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="item-warranty"
                label={t('warrantyMonths')}
                helper={t('warrantyHelper')}
                error={stockProblems.warrantyMonths ?? fieldError('warrantyMonths')}
              >
                <Input
                  name="warrantyMonths"
                  inputMode="numeric"
                  maxLength={3}
                  autoComplete="off"
                  defaultValue={item?.warrantyMonths ?? ''}
                  className="tabular-nums"
                />
              </Field>
              <Field
                id="item-supplier-warranty"
                label={t('supplierWarrantyMonths')}
                helper={t('supplierWarrantyHelper')}
                error={stockProblems.supplierWarrantyMonths ?? fieldError('supplierWarrantyMonths')}
              >
                <Input
                  name="supplierWarrantyMonths"
                  inputMode="numeric"
                  maxLength={3}
                  autoComplete="off"
                  defaultValue={item?.supplierWarrantyMonths ?? ''}
                  className="tabular-nums"
                />
              </Field>
            </div>
            <Field
              id="item-barcode"
              label={t('barcode')}
              helper={t('barcodeHelper')}
              error={fieldError('barcode')}
            >
              <Input
                name="barcode"
                maxLength={BARCODE_MAX_LENGTH}
                autoComplete="off"
                spellCheck={false}
                defaultValue={item?.barcode ?? ''}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="item-purchase-unit"
                label={t('purchaseUnit')}
                error={fieldError('purchaseUnit')}
              >
                <Select
                  name="purchaseUnit"
                  value={purchaseUnit}
                  onChange={(e) => {
                    setPurchaseUnit(e.currentTarget.value as ItemUnit | '');
                  }}
                >
                  <option value="">{t('purchaseUnitSame')}</option>
                  {ITEM_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {text.unit(u)}
                    </option>
                  ))}
                </Select>
              </Field>
              {needsFactor ? (
                <Field
                  id="item-purchase-factor"
                  label={t('purchaseUnitFactor')}
                  helper={t('purchaseUnitFactorHelper', { stocked: text.unit(unit) })}
                  error={stockProblems.purchaseUnitFactor ?? fieldError('purchaseUnitFactor')}
                >
                  <Input
                    name="purchaseUnitFactor"
                    inputMode="decimal"
                    maxLength={14}
                    autoComplete="off"
                    defaultValue={item?.purchaseUnitFactor ?? ''}
                    className="tabular-nums"
                  />
                </Field>
              ) : null}
            </div>
            {serialTracked ? (
              <Field
                id="item-serial-pattern"
                label={t('serialPattern')}
                helper={t('serialPatternHelper')}
                error={fieldError('serialPattern')}
              >
                <Input
                  name="serialPattern"
                  maxLength={SERIAL_PATTERN_MAX}
                  autoComplete="off"
                  spellCheck={false}
                  defaultValue={item?.serialPattern ?? ''}
                  className="font-mono"
                />
              </Field>
            ) : null}
            {mayBeService && !serialTracked ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="isStocked"
                  className="accent-accent size-4"
                  defaultChecked={item?.isStocked ?? true}
                />
                {t('isStocked')}
              </label>
            ) : null}
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
