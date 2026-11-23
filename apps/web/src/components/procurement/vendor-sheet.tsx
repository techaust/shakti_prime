'use client';

import type {
  ItemVendorDto,
  VendorDto,
  VendorQuoteDto,
  VendorSheetDto,
  VendorSheetWithQuotesDto,
} from '@shakti/contracts';
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
import {
  archiveVendor,
  getVendor,
  setItemVendor,
  withdrawVendorQuote,
} from '../../actions/procurement';
import { formatDate, formatPhone } from '../../screens/format';
import { formatQuantity, formatRate, QUOTE_STATUS_TONE } from '../../screens/procurement';
import { useOpenFile } from '../files/use-open-file';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import { ContactsDialog, ItemLinkDialog } from './vendor-links-form';
import { VendorFormDialog } from './vendor-form';
import { QuoteFormDialog } from './quote-form';
import type { VendorPowers } from './vendors-screen';

type Sheet = VendorSheetDto | VendorSheetWithQuotesDto;
type DialogKind = 'edit' | 'contacts' | 'item' | 'archive' | 'quote';

/**
 * The vendor sheet: the vendor's details, its people and the items it supplies, and, for a
 * holder of `procurement.rate.read`, its quotes. A holder of `procurement.po.write` edits the
 * vendor, its people and its items, and archives it; one who also reads rates records and
 * withdraws quotes.
 */
export function VendorSheet({
  vendorId,
  powers,
  uploadLimit,
  returnFocusTo,
  onClose,
  onChanged,
}: {
  vendorId: string;
  powers: VendorPowers;
  uploadLimit: { contentTypes: readonly string[]; maxBytes: number };
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onChanged: (vendor: VendorDto, itemCount: number) => void;
}) {
  const t = useTranslations('procurement.sheet');
  const p = useTranslations('procurement');
  const common = useTranslations('common');
  const { load, pending, failure } = useQuery<Sheet>();
  const [sheet, setSheet] = useState<Sheet | undefined>();
  const [dialog, setDialog] = useState<DialogKind | undefined>();
  const [withdrawing, setWithdrawing] = useState<VendorQuoteDto | undefined>();
  const editButton = useRef<HTMLButtonElement>(null);
  const contactsButton = useRef<HTMLButtonElement>(null);
  const itemButton = useRef<HTMLButtonElement>(null);
  const archiveButton = useRef<HTMLButtonElement>(null);
  const quoteButton = useRef<HTMLButtonElement>(null);
  const unlink = useCommand(setItemVendor);
  const doc = useOpenFile();

  function reload() {
    load(
      () => getVendor({ vendorId }),
      (loaded) => {
        setSheet(loaded);
        onChanged(loaded.vendor, loaded.items.length);
      },
    );
  }

  useEffect(() => {
    load(
      () => getVendor({ vendorId }),
      (loaded) => {
        setSheet(loaded);
      },
    );
  }, [load, vendorId]);

  const quotes = sheet !== undefined && 'quotes' in sheet ? sheet.quotes : undefined;
  const active = sheet?.vendor.isActive === true;
  const canWrite = powers.canWrite && active;
  const days = (n: number | null) => (n === null ? p('notRecorded') : p('days', { count: n }));
  const closeDialog = () => {
    setDialog(undefined);
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        {sheet === undefined ? (
          <>
            <SheetHeader>
              <SheetTitle>{t('loading')}</SheetTitle>
            </SheetHeader>
            <FailureMessage failure={failure} />
            {pending ? (
              <div className="flex flex-col gap-3" aria-busy>
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{sheet.vendor.name}</SheetTitle>
              <SheetDescription>{sheet.vendor.gstin ?? t('unregistered')}</SheetDescription>
            </SheetHeader>
            {active ? null : (
              <p className="text-text-muted">
                <StatusBadge tone="neutral">{p('status.archived')}</StatusBadge> {t('archivedNote')}
              </p>
            )}
            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  ref={editButton}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDialog('edit');
                  }}
                >
                  {t('edit')}
                </Button>
                <Button
                  ref={archiveButton}
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setDialog('archive');
                  }}
                >
                  {t('archive')}
                </Button>
              </div>
            ) : null}
            <section aria-labelledby="vendor-details" className="flex flex-col gap-2">
              <h3 id="vendor-details" className="text-h3">
                {t('details')}
              </h3>
              <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2">
                <Detail label={t('gstin')} value={sheet.vendor.gstin ?? p('notRecorded')} />
                <Detail label={t('pan')} value={sheet.vendor.pan ?? p('notRecorded')} />
                <Detail
                  label={t('address')}
                  value={
                    [
                      sheet.vendor.address.line1,
                      sheet.vendor.address.line2,
                      sheet.vendor.address.city,
                      sheet.vendor.address.pin,
                    ]
                      .filter((x) => x !== undefined)
                      .join(', ') || p('notRecorded')
                  }
                />
                <Detail label={t('paymentTerms')} value={days(sheet.vendor.paymentTermsDays)} />
                <Detail label={t('leadTime')} value={days(sheet.vendor.leadTimeDays)} />
                {sheet.vendor.notes === null ? null : (
                  <Detail label={t('notes')} value={sheet.vendor.notes} />
                )}
              </dl>
            </section>

            <section aria-labelledby="vendor-people" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="vendor-people" className="text-h3">
                  {t('people')}
                </h3>
                {canWrite ? (
                  <Button
                    ref={contactsButton}
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDialog('contacts');
                    }}
                  >
                    {t('editPeople')}
                  </Button>
                ) : null}
              </div>
              {sheet.contacts.length === 0 ? (
                <p className="text-text-muted">{t('noPeople')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {sheet.contacts.map((c) => (
                    <li key={c.id} className="border-border rounded-md border px-3 py-2">
                      <p className="font-medium">
                        {c.name}
                        {c.role === null ? null : (
                          <span className="text-text-muted font-normal"> · {c.role}</span>
                        )}
                      </p>
                      {c.phone === null ? null : (
                        <p className="tabular-nums">
                          <a className="text-accent underline" href={`tel:${c.phone}`}>
                            {formatPhone(c.phone)}
                          </a>
                        </p>
                      )}
                      {c.email === null ? null : (
                        <p className="break-all">
                          <a className="text-accent underline" href={`mailto:${c.email}`}>
                            {c.email}
                          </a>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="vendor-items" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="vendor-items" className="text-h3">
                  {t('items')}
                </h3>
                {canWrite ? (
                  <Button
                    ref={itemButton}
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDialog('item');
                    }}
                  >
                    {t('addItem')}
                  </Button>
                ) : null}
              </div>
              <FailureMessage failure={unlink.failure} />
              {sheet.items.length === 0 ? (
                <p className="text-text-muted">{t('noItems')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {sheet.items.map((i) => (
                    <ItemRow
                      key={i.id}
                      link={i}
                      canWrite={canWrite}
                      pending={unlink.pending}
                      onRemove={() => {
                        unlink.run({ vendorId, itemId: i.itemId, supplies: false }, () => {
                          toast.success(t('itemRemoved', { item: i.itemName }));
                          reload();
                        });
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>

            {quotes === undefined ? null : (
              <section aria-labelledby="vendor-quotes" className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="vendor-quotes" className="text-h3">
                    {t('quotes')}
                  </h3>
                  {powers.canRecordQuotes && active ? (
                    <Button
                      ref={quoteButton}
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setDialog('quote');
                      }}
                    >
                      {t('recordQuote')}
                    </Button>
                  ) : null}
                </div>
                <FailureMessage failure={doc.failure} />
                {quotes.length === 0 ? (
                  <p className="text-text-muted">{t('noQuotes')}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {quotes.map((q) => (
                      <li key={q.id} className="border-border rounded-md border px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">{q.itemName}</p>
                          <StatusBadge tone={QUOTE_STATUS_TONE[q.status]}>
                            {p(`quoteStatus.${q.status}`)}
                          </StatusBadge>
                        </div>
                        <p className="tabular-nums">
                          {t('ratePer', { rate: formatRate(q.rate), unit: p(`units.${q.unit}`) })}
                        </p>
                        <p className="text-text-muted">
                          {t('validity', {
                            from: formatDate(q.validFrom),
                            until: formatDate(q.validUntil),
                          })}
                          {' · '}
                          {q.entityId === null
                            ? t('forGroup')
                            : t('forCompany', {
                                company:
                                  powers.quoteCompanies.find((c) => c.entityId === q.entityId)
                                    ?.name ?? t('oneCompany'),
                              })}
                        </p>
                        <p className="text-text-muted">
                          {q.moq === null ? t('noMoq') : t('moq', { qty: formatQuantity(q.moq) })}
                          {' · '}
                          {q.leadTimeDays === null
                            ? t('noLeadTime')
                            : p('days', { count: q.leadTimeDays })}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {q.fileId === null ? null : (
                            <Button
                              variant="link"
                              size="sm"
                              pending={doc.opening}
                              onClick={() => {
                                if (q.fileId !== null) doc.open(q.fileId);
                              }}
                            >
                              {t('openDocument')}
                            </Button>
                          )}
                          {powers.canRecordQuotes &&
                          (q.status === 'live' || q.status === 'upcoming') ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              aria-label={t('withdrawFor', { item: q.itemName })}
                              onClick={() => {
                                setWithdrawing(q);
                              }}
                            >
                              {t('withdraw')}
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {dialog === 'edit' ? (
              <VendorFormDialog
                vendor={sheet.vendor}
                returnFocusTo={() => [editButton.current]}
                onClose={closeDialog}
                onSaved={() => {
                  closeDialog();
                  reload();
                }}
              />
            ) : null}
            {dialog === 'contacts' ? (
              <ContactsDialog
                vendorId={vendorId}
                vendorName={sheet.vendor.name}
                contacts={sheet.contacts}
                returnFocusTo={() => [contactsButton.current]}
                onClose={closeDialog}
                onSaved={() => {
                  closeDialog();
                  reload();
                }}
              />
            ) : null}
            {dialog === 'item' ? (
              <ItemLinkDialog
                vendorId={vendorId}
                vendorName={sheet.vendor.name}
                exclude={sheet.items.map((i) => i.itemId)}
                returnFocusTo={() => [itemButton.current]}
                onClose={closeDialog}
                onSaved={() => {
                  closeDialog();
                  reload();
                }}
              />
            ) : null}
            {dialog === 'quote' ? (
              <QuoteFormDialog
                vendor={sheet.vendor}
                items={sheet.items}
                companies={powers.quoteCompanies}
                uploadLimit={uploadLimit}
                returnFocusTo={() => [quoteButton.current]}
                onClose={closeDialog}
                onSaved={() => {
                  closeDialog();
                  reload();
                }}
              />
            ) : null}
            {dialog === 'archive' ? (
              <ArchiveVendorDialog
                vendor={sheet.vendor}
                returnFocusTo={() => [archiveButton.current]}
                onClose={closeDialog}
                onDone={() => {
                  closeDialog();
                  reload();
                }}
              />
            ) : null}
            {withdrawing === undefined ? null : (
              <WithdrawQuoteDialog
                quote={withdrawing}
                onClose={() => {
                  setWithdrawing(undefined);
                }}
                onDone={() => {
                  setWithdrawing(undefined);
                  reload();
                }}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  );
}

function ItemRow({
  link,
  canWrite,
  pending,
  onRemove,
}: {
  link: ItemVendorDto;
  canWrite: boolean;
  pending: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations('procurement.sheet');
  return (
    <li className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <p className="font-medium">
          {link.itemName}{' '}
          {link.isPreferred ? <StatusBadge tone="info">{t('preferred')}</StatusBadge> : null}
        </p>
        <p className="text-text-muted">
          {link.sku}
          {link.vendorItemCode === null
            ? null
            : ` · ${t('theirCode', { code: link.vendorItemCode })}`}
        </p>
      </div>
      {canWrite ? (
        <Button
          variant="secondary"
          size="sm"
          pending={pending}
          aria-label={t('removeItemFor', { item: link.itemName })}
          onClick={onRemove}
        >
          {t('removeItem')}
        </Button>
      ) : null}
    </li>
  );
}

function ArchiveVendorDialog({
  vendor,
  returnFocusTo,
  onClose,
  onDone,
}: {
  vendor: VendorDto;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('procurement.archiveVendor');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(archiveVendor);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <DialogHeader>
          <DialogTitle>{t('title', { name: vendor.name })}</DialogTitle>
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
              run({ vendorId: vendor.id }, () => {
                toast.success(t('done', { name: vendor.name }));
                onDone();
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

function WithdrawQuoteDialog({
  quote,
  onClose,
  onDone,
}: {
  quote: VendorQuoteDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('procurement.withdrawQuote');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(withdrawVendorQuote);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { item: quote.itemName })}</DialogTitle>
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
              run({ quoteId: quote.id }, () => {
                toast.success(t('done', { item: quote.itemName }));
                onDone();
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
