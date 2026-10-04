'use client';

import type { EntityDto, FileDto, FilePurpose } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Uploader,
  type ReturnFocusTo,
  type UploadControls,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { openFile } from '../../actions/files';
import { fileTypeKey, sizeParts } from '../../screens/files';
import { sendFile } from '../files/send-file';
import { FailureMessage } from '../screens/failure';
import { settle } from '../screens/settle';
import type { CommandFailure } from '../screens/use-command';

/** A purpose's limits, worked out on the server from `UPLOAD_LIMITS`. */
export interface UploadLimitView {
  contentTypes: readonly string[];
  maxBytes: number;
}

export type BrandingPurpose = Extract<FilePurpose, 'entity_logo' | 'letterhead'>;

/**
 * Settings › Companies: the dialog where an Executive uploads a company's logo and letterhead,
 * loaded on demand by the companies screen. Each is stored as a file of its purpose; the company's
 * documents print the newest ready one.
 */
export function BrandingDialog({
  company,
  current,
  limits,
  closeLabel,
  returnFocusTo,
  onUploaded,
  onClose,
}: {
  company: EntityDto;
  current: Record<BrandingPurpose, FileDto | undefined>;
  limits: Record<BrandingPurpose, UploadLimitView>;
  closeLabel: string;
  returnFocusTo: ReturnFocusTo;
  onUploaded: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('companies');
  const common = useTranslations('common');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={closeLabel} returnFocusTo={returnFocusTo}>
        <DialogHeader>
          <DialogTitle>{t('brandingTitle', { name: company.legalName })}</DialogTitle>
          <DialogDescription>{t('brandingIntro')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          {(['entity_logo', 'letterhead'] as const).map((purpose) => (
            <BrandingUpload
              key={purpose}
              company={company}
              purpose={purpose}
              current={current[purpose]}
              limit={limits[purpose]}
              onUploaded={onUploaded}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {common('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BrandingUpload({
  company,
  purpose,
  current,
  limit,
  onUploaded,
}: {
  company: EntityDto;
  purpose: BrandingPurpose;
  current: FileDto | undefined;
  limit: UploadLimitView;
  onUploaded: () => void;
}) {
  const t = useTranslations('companies');
  const files = useTranslations('files');
  const errors = useTranslations('errors');
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<CommandFailure | undefined>();

  const types = new Intl.ListFormat('en-IN', { type: 'disjunction' }).format(
    limit.contentTypes.flatMap((type) => {
      const key = fileTypeKey(type);
      return key === undefined ? [] : [files(`shortTypes.${key}`)];
    }),
  );
  const size = sizeParts(limit.maxBytes);
  const sizeText = files(`size.${size.unit}`, { value: size.value });
  const limits = files('uploader.limits', { types, size: sizeText });
  const label = purpose === 'entity_logo' ? t('logo') : t('letterhead');
  const hint = purpose === 'letterhead' ? `${t('letterheadHelper')} ${limits}` : limits;

  return (
    <section className="flex flex-col gap-2">
      <Uploader
        id={`${purpose}-${String(company.id)}`}
        label={label}
        hint={hint}
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
        upload={(file: File, controls: UploadControls) =>
          sendFile(file, { entityId: company.id, purpose }, controls, {
            checking: files('uploader.checking'),
            checkingLong: files('uploader.checkingLong'),
            ready: t('ready'),
            failed: files('uploader.failed'),
            error: (key) => errors(key),
          })
        }
        onUploaded={(result) => {
          if (result.status === 'done') onUploaded();
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-text-muted text-sm">
          {current === undefined ? t('none') : t('current', { name: current.name })}
        </p>
        {current === undefined ? null : (
          <Button
            variant="link"
            size="sm"
            pending={opening}
            onClick={() => {
              // Opened now, while the click still counts as the person's own, so no pop-up
              // blocker stops it; the signed address is filled in when it arrives.
              const tab = window.open('about:blank', '_blank');
              if (tab !== null) tab.opener = null;
              setOpening(true);
              void settle(() => openFile(current.id)).then((result) => {
                setOpening(false);
                if (result.ok) {
                  setFailure(undefined);
                  if (tab === null) window.location.assign(result.data.url);
                  else tab.location.href = result.data.url;
                  return;
                }
                tab?.close();
                setFailure((previous) => ({
                  error: result.error,
                  reference: result.reference,
                  attempt: (previous?.attempt ?? 0) + 1,
                }));
              });
            }}
          >
            {t('open')}
          </Button>
        )}
      </div>
      <FailureMessage failure={failure} />
    </section>
  );
}
