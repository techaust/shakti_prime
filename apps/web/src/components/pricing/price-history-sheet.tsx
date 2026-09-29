'use client';

import type { PriceChangeDto, PriceChangePageDto } from '@shakti/contracts';
import {
  Button,
  EmptyState,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { listPriceChanges } from '../../actions/pricing';
import { formatDateTime, formatRupees } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';

/**
 * The price history of one item or kit on every list the reader can see, newest first, from
 * `price_change_log`: each change with its list, who made it, when and why.
 */
export function PriceHistorySheet({
  target,
  companies,
  returnFocusTo,
  onClose,
}: {
  target: { kind: 'item' | 'kit'; id: string; name: string };
  companies: Record<number, string>;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
}) {
  const t = useTranslations('priceMaster');
  const common = useTranslations('common');
  const { load, pending, failure } = useQuery<PriceChangePageDto>();
  const [changes, setChanges] = useState<PriceChangeDto[] | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const which = target.kind === 'item' ? { itemId: target.id } : { kitId: target.id };
  useEffect(() => {
    load(
      () => listPriceChanges(target.kind === 'item' ? { itemId: target.id } : { kitId: target.id }),
      (page) => {
        setChanges(page.items);
        setNextCursor(page.nextCursor);
      },
    );
  }, [load, target.kind, target.id]);

  function loadMore() {
    if (nextCursor === null) return;
    load(
      () => listPriceChanges({ ...which, cursor: nextCursor }),
      (page) => {
        setChanges((all) => [...(all ?? []), ...page.items]);
        setNextCursor(page.nextCursor);
      },
    );
  }

  const listName = (c: PriceChangeDto) =>
    t('listOption', {
      tier: c.tierName,
      company:
        c.entityId === null ? t('shared') : (companies[c.entityId] ?? t('shared')),
      version: c.version,
    });

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <SheetHeader>
          <SheetTitle>{t('historySheet.title', { item: target.name })}</SheetTitle>
          <SheetDescription>{t('historySheet.intro')}</SheetDescription>
        </SheetHeader>
        <FailureMessage failure={failure} />
        {changes === undefined ? (
          pending ? (
            <ul className="flex flex-col gap-3" aria-busy>
              {[0, 1, 2].map((i) => (
                <li key={i} className="border-border flex flex-col gap-2 rounded-lg border p-4">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                </li>
              ))}
            </ul>
          ) : null
        ) : changes.length === 0 ? (
          <EmptyState message={t('historySheet.empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {changes.map((c) => (
              <li key={c.id} className="border-border flex flex-col gap-1 rounded-lg border p-4">
                <span className="font-medium tabular-nums">
                  {c.oldPrice === null
                    ? t('historySheet.first', { to: formatRupees(c.newPrice) })
                    : t('historySheet.change', {
                        from: formatRupees(c.oldPrice),
                        to: formatRupees(c.newPrice),
                      })}
                </span>
                <span className="text-text-muted text-sm">
                  {t('historySheet.on', { list: listName(c), when: formatDateTime(c.createdAt) })}
                </span>
                {c.changedByName === null ? null : (
                  <span className="text-text-muted text-sm">
                    {t('historySheet.by', { name: c.changedByName })}
                  </span>
                )}
                {c.reason === null ? null : (
                  <span className="text-sm break-words">
                    {t('historySheet.reason', { reason: c.reason })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {nextCursor === null ? null : (
          <Button variant="secondary" pending={pending} onClick={loadMore}>
            {common('loadMore')}
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
}
