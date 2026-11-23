'use client';

import type { ItemDto, ItemVendorDto, VendorDto } from '@shakti/contracts';
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
  Select,
  toast,
  Uploader,
  type ReturnFocusTo,
  type UploadControls,
  type UploadResult,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import { recordVendorQuote } from '../../actions/procurement';
import { fileTypeKey, sizeParts } from '../../screens/files';
import { rateFromTyped } from '../../screens/procurement';
import { ItemPicker } from '../catalogue/item-picker';
import { sendFile } from '../files/send-file';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/**
 * A company a quote may be recorded for: one the person holds both grants in, or the group
 * (`entityId: null`) when the request covers every company. Worked out on the server.
 */
export interface QuoteCompany {
  entityId: number | null;
  name: string;
}

const FIELDS = ['rate', 'moq', 'leadTimeDays', 'validFrom', 'validUntil', 'fileId'] as const;

type Problem = 'item' | 'rate' | 'moq' | 'leadTime' | 'validFrom' | 'validUntil' | 'order';

/**
 * Records a supplier's quote: the item, the company it was given to (or the whole group), the
 * rate per unit before GST, the minimum order, the delivery time and the dates it holds, with the
 * quote document uploaded as a `vendor_quote` file of the company.
 */
export function QuoteFormDialog({
  vendor,
  items,
  companies,
  uploadLimit,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  vendor: VendorDto;
  items: readonly ItemVendorDto[];
  companies: readonly QuoteCompany[];
  uploadLimit: { contentTypes: readonly string[]; maxBytes: number };
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('procurement.quoteForm');
  const files = useTranslations('files');
  const errors = useTranslations('errors');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(recordVendorQuote);
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);
  const [itemId, setItemId] = useState<string>(items[0]?.itemId ?? '');
  const [picked, setPicked] = useState<ItemDto | undefined>();
  const [company, setCompany] = useState<string>(String(companies[0]?.entityId ?? ''));
  const [problem, setProblem] = useState<Problem | undefined>();
  const [fileId, setFileId] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const recorded = useRef<string | undefined>(undefined);

  const entityId = company === 'null' || company === '' ? null : Number(company);
  // The document is stored in the quote's company; a group quote's in the first company listed.
  const storeIn = entityId ?? companies.find((c) => c.entityId !== null)?.entityId ?? undefined;

  const types = new Intl.ListFormat('en-IN', { type: 'disjunction' }).format(
    uploadLimit.contentTypes.flatMap((type) => {
      const key = fileTypeKey(type);
      return key === undefined ? [] : [files(`shortTypes.${key}`)];
    }),
  );
  const size = sizeParts(uploadLimit.maxBytes);
  const sizeText = files(`size.${size.unit}`, { value: size.value });

  async function upload(file: File, controls: UploadControls): Promise<UploadResult> {
    recorded.current = undefined;
    setFileId(undefined);
    setUploading(true);
    let result: UploadResult | undefined;
    try {
      if (storeIn === undefined)
        return { status: 'failed', message: t('noCompany'), canRetry: false };
      result = await sendFile(
        file,
        { entityId: storeIn, purpose: 'vendor_quote' },
        controls,
        {
          checking: files('uploader.checking'),
          checkingLong: t('checkingLong'),
          ready: t('ready'),
          failed: files('uploader.failed'),
          error: (key) => errors(key),
        },
        (id) => {
          recorded.current = id;
        },
      );
      return result;
    } finally {
      const kept = !controls.signal.aborted && result !== undefined && result.status !== 'failed';
      setFileId(kept ? recorded.current : undefined);
      setUploading(false);
    }
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || uploading) return;
    const data = new FormData(e.currentTarget);
    const chosen = picked?.id ?? itemId;
    const rate = rateFromTyped(formText(data, 'rate'));
    const moqText = formText(data, 'moq').replaceAll(/[\s,]/g, '');
    const leadText = formText(data, 'leadTimeDays').trim();
    const validFrom = formText(data, 'validFrom');
    const validUntil = formText(data, 'validUntil');
    const found: Problem | undefined =
      chosen === ''
        ? 'item'
        : rate === undefined
          ? 'rate'
          : moqText !== '' && !/^\d{1,9}(\.\d{1,3})?$/.test(moqText)
            ? 'moq'
            : leadText !== '' && !/^\d{1,3}$/.test(leadText)
              ? 'leadTime'
              : validFrom === ''
                ? 'validFrom'
                : validUntil === ''
                  ? 'validUntil'
                  : validUntil < validFrom
                    ? 'order'
                    : undefined;
    setProblem(found);
    if (found !== undefined || rate === undefined) return;
    run(
      {
        vendorId: vendor.id,
        itemId: chosen,
        entityId,
        rate,
        moq: moqText === '' ? null : moqText,
        leadTimeDays: leadText === '' ? null : Number(leadText),
        validFrom,
        validUntil,
        fileId: fileId ?? null,
      },
      (saved) => {
        toast.success(t('saved', { item: saved.itemName, name: vendor.name }));
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
            <DialogTitle>{t('title', { name: vendor.name })}</DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          {items.length > 0 && picked === undefined ? (
            <Field
              id="quote-item"
              label={t('item')}
              helper={t('itemHelper')}
              error={problem === 'item' ? t('itemMissing') : undefined}
            >
              <Select
                value={itemId}
                onChange={(e) => {
                  setItemId(e.currentTarget.value);
                }}
              >
                {items.map((i) => (
                  <option key={i.itemId} value={i.itemId}>
                    {i.itemName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : picked === undefined ? (
            <ItemPicker
              id="quote-item-search"
              label={t('item')}
              helper={t('itemSearchHelper')}
              noneFound={t('noneFound')}
              chooseLabel={t('choose')}
              chooseFor={(i) => t('chooseFor', { item: i.name })}
              error={problem === 'item' ? t('itemMissing') : undefined}
              onChoose={(i) => {
                setPicked(i);
              }}
            />
          ) : (
            <p>
              <span className="font-medium">{picked.name}</span>{' '}
              <span className="text-text-muted">{picked.sku}</span>
            </p>
          )}
          <Field id="quote-company" label={t('company')} helper={t('companyHelper')}>
            <Select
              value={company}
              onChange={(e) => {
                setCompany(e.currentTarget.value);
                // A document is stored in one company: a new choice asks for it again (review L2).
                recorded.current = undefined;
                setFileId(undefined);
              }}
            >
              {companies.map((c) => (
                <option key={String(c.entityId)} value={String(c.entityId)}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="quote-rate"
              label={t('rate')}
              helper={t('rateHelper')}
              error={problem === 'rate' ? t('rateWrong') : fieldError('rate')}
            >
              <Input
                name="rate"
                inputMode="decimal"
                maxLength={20}
                autoComplete="off"
                className="tabular-nums"
              />
            </Field>
            <Field
              id="quote-moq"
              label={t('moq')}
              helper={t('moqHelper')}
              error={problem === 'moq' ? t('moqWrong') : fieldError('moq')}
            >
              <Input
                name="moq"
                inputMode="decimal"
                maxLength={14}
                autoComplete="off"
                className="tabular-nums"
              />
            </Field>
          </div>
          <Field
            id="quote-lead-time"
            label={t('leadTime')}
            helper={t('leadTimeHelper')}
            error={problem === 'leadTime' ? t('leadTimeWrong') : fieldError('leadTimeDays')}
          >
            <Input
              name="leadTimeDays"
              inputMode="numeric"
              maxLength={3}
              autoComplete="off"
              defaultValue={vendor.leadTimeDays?.toString() ?? ''}
              className="tabular-nums"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="quote-valid-from"
              label={t('validFrom')}
              error={problem === 'validFrom' ? t('dateWrong') : fieldError('validFrom')}
            >
              <DateInput name="validFrom" />
            </Field>
            <Field
              id="quote-valid-until"
              label={t('validUntil')}
              error={
                problem === 'validUntil'
                  ? t('dateWrong')
                  : problem === 'order'
                    ? t('orderWrong')
                    : fieldError('validUntil')
              }
            >
              <DateInput name="validUntil" />
            </Field>
          </div>
          <Uploader
            key={company}
            id={`quote-document-${vendor.id}`}
            label={t('document')}
            hint={`${t('documentHelper')} ${files('uploader.limits', { types, size: sizeText })}`}
            accept={uploadLimit.contentTypes}
            maxBytes={uploadLimit.maxBytes}
            text={{
              choose: files('uploader.choose'),
              drop: files('uploader.drop'),
              cancel: files('uploader.cancel'),
              retry: files('uploader.retry'),
              started: files('uploader.started'),
              halfway: files('uploader.halfway'),
              cancelled: files('uploader.cancelled'),
              failed: files('uploader.failed'),
              wrongType: files('uploader.wrongType', { types }),
              tooLarge: files('uploader.tooLarge', { size: sizeText }),
              empty: files('uploader.empty'),
            }}
            upload={upload}
          />
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending || uploading}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
