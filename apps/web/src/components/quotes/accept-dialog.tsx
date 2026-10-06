'use client';

import type { QuoteDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Uploader,
  type UploadControls,
  type UploadResult,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import { acceptQuote } from '../../actions/orders';
import { fileTypeKey, sizeParts } from '../../screens/files';
import type { UploadLimitView } from '../companies/branding-dialog';
import { sendFile } from '../files/send-file';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

/**
 * Record acceptance (docs/design/phase1.md §8.3, SAL-05), loaded on first use by the quote page:
 * the person uploads the customer's signed copy, as a `signed_quote` file of the quote's company,
 * and once it has passed its checks records the acceptance, which accepts the quote and makes its
 * order (`sales.quote.accept`).
 */
export function AcceptDialog({
  quote,
  limit,
  closeLabel,
  onCancel,
  onDone,
}: {
  quote: QuoteDto;
  limit: UploadLimitView;
  closeLabel: string;
  onCancel: () => void;
  onDone: (quote: QuoteDto) => void;
}) {
  const t = useTranslations('orders.accept');
  const files = useTranslations('files');
  const errors = useTranslations('errors');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(acceptQuote);
  const [signed, setSigned] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const recorded = useRef<string | undefined>(undefined);

  const types = new Intl.ListFormat('en-IN', { type: 'disjunction' }).format(
    limit.contentTypes.flatMap((type) => {
      const key = fileTypeKey(type);
      return key === undefined ? [] : [files(`shortTypes.${key}`)];
    }),
  );
  const size = sizeParts(limit.maxBytes);
  const sizeText = files(`size.${size.unit}`, { value: size.value });

  async function upload(file: File, controls: UploadControls): Promise<UploadResult> {
    recorded.current = undefined;
    setSigned(undefined);
    setUploading(true);
    let result: UploadResult | undefined;
    try {
      result = await sendFile(
        file,
        { entityId: quote.entityId, purpose: 'signed_quote' },
        controls,
        {
          checking: files('uploader.checking'),
          checkingLong: t('checkingLong'),
          ready: t('ready'),
          failed: files('uploader.failed'),
          error: (key) => errors(key),
        },
        (fileId) => {
          recorded.current = fileId;
        },
      );
      return result;
    } finally {
      const kept = !controls.signal.aborted && result !== undefined && result.status !== 'failed';
      setSigned(kept ? recorded.current : undefined);
      setUploading(false);
    }
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || signed === undefined) return;
    run({ entityId: quote.entityId, quoteId: quote.id, signedFileId: signed }, onDone);
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent closeLabel={closeLabel}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          <Uploader
            id={`signed-copy-${quote.id}`}
            label={t('file')}
            hint={`${t('fileHelper')} ${files('uploader.limits', { types, size: sizeText })}`}
            accept={limit.contentTypes}
            maxBytes={limit.maxBytes}
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
          <FailureMessage failure={failure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onCancel}>
              {common('cancel')}
            </Button>
            <Button
              type="submit"
              pending={pending || uploading}
              disabled={signed === undefined && !uploading}
            >
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
