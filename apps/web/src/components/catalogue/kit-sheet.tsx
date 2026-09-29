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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  StatusBadge,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { archiveKit, getKit } from '../../actions/catalogue';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import { KitFormDialog } from './kit-form';
import { useCatalogueText } from './use-spec-text';

/** The kit sheet: a kit's items and quantities, with edit and stop selling for the catalogue team. */
export function KitSheet({
  kitId,
  canWrite,
  returnFocusTo,
  onClose,
  onChanged,
}: {
  kitId: string;
  canWrite: boolean;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onChanged: (kit: KitDetailDto) => void;
}) {
  const t = useTranslations('catalogue');
  const common = useTranslations('common');
  const text = useCatalogueText();
  const { load, pending, failure } = useQuery<KitDetailDto>();
  const [kit, setKit] = useState<KitDetailDto | undefined>();
  const [dialog, setDialog] = useState<'edit' | 'archive' | undefined>();
  const editButton = useRef<HTMLButtonElement>(null);
  const archiveButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    load(
      () => getKit({ kitId }),
      (loaded) => {
        setKit(loaded);
      },
    );
  }, [load, kitId]);

  function changed(next: KitDetailDto) {
    setKit(next);
    onChanged(next);
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        {kit === undefined ? (
          <>
            <SheetHeader>
              <SheetTitle>{t('kit.loading')}</SheetTitle>
            </SheetHeader>
            <FailureMessage failure={failure} />
            {pending ? (
              <div className="flex flex-col gap-3" aria-busy>
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{kit.name}</SheetTitle>
              <SheetDescription>{kit.sku}</SheetDescription>
            </SheetHeader>
            {kit.isActive ? null : (
              <p className="text-text-muted">
                <StatusBadge tone="neutral">{t('status.archived')}</StatusBadge>{' '}
                {t('kit.archivedNote')}
              </p>
            )}
            {canWrite && kit.isActive ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  ref={editButton}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDialog('edit');
                  }}
                >
                  {t('kit.edit')}
                </Button>
                <Button
                  ref={archiveButton}
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setDialog('archive');
                  }}
                >
                  {t('kit.archive')}
                </Button>
              </div>
            ) : null}
            <section aria-labelledby="kit-components" className="flex flex-col gap-2">
              <h3 id="kit-components" className="text-h3">
                {t('kit.componentsHeading')}
              </h3>
              <table className="w-full text-left">
                <caption className="sr-only">{t('kit.componentsCaption')}</caption>
                <thead className="text-text-muted">
                  <tr>
                    <th scope="col" className="py-1 font-medium">
                      {t('columns.name')}
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      {t('kit.quantity')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {kit.components.map((c) => (
                    <tr key={c.itemId} className="border-border border-t align-top">
                      <td className="py-2 pr-2">
                        <span className="block break-words">{c.name}</span>
                        <span className="text-text-muted block text-sm">
                          {c.sku} · {text.category(c.category)}
                        </span>
                        {c.itemActive ? null : (
                          <StatusBadge tone="warning">{t('kit.itemGone')}</StatusBadge>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {Number(c.qty).toLocaleString('en-IN')} {text.unit(c.unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            {dialog === 'edit' ? (
              <KitFormDialog
                kit={kit}
                returnFocusTo={() => [editButton.current]}
                onClose={() => {
                  setDialog(undefined);
                }}
                onSaved={(saved) => {
                  setDialog(undefined);
                  changed(saved);
                }}
              />
            ) : null}
            {dialog === 'archive' ? (
              <ArchiveKitDialog
                kit={kit}
                returnFocusTo={() => [archiveButton.current]}
                onClose={() => {
                  setDialog(undefined);
                }}
                onDone={(archived) => {
                  setDialog(undefined);
                  changed(archived);
                }}
              />
            ) : null}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ArchiveKitDialog({
  kit,
  returnFocusTo,
  onClose,
  onDone,
}: {
  kit: KitDetailDto;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onDone: (archived: KitDetailDto) => void;
}) {
  const t = useTranslations('catalogue.archiveKit');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(archiveKit);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <DialogHeader>
          <DialogTitle>{t('title', { name: kit.name })}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>
        <FailureMessage failure={failure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button
            variant="danger"
            pending={pending}
            onClick={() => {
              run({ kitId: kit.id }, (archived) => {
                toast.success(t('done', { name: kit.name }));
                onDone(archived);
              });
            }}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
