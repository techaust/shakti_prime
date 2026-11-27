'use client';

import type { ReorderRuleRowDto } from '@shakti/contracts';
import { Button, Field, Input, Select, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { listReorderRules, removeReorderRule, setReorderRule } from '../../actions/purchase-orders';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

/** A stored quantity as people read it: `5.000` is `5`. */
const plain = (qty: string) => (qty.includes('.') ? qty.replace(/\.?0+$/, '') : qty);

/**
 * Reorder rules on an item's stock card (docs/03-roadmap-appendix/phase3.md §7.2): per hub, the
 * level below which the reorder job drafts a purchase order of the quantity, from the item's
 * preferred vendor and with no rate. Set and removed with `procurement.po.write`.
 */
export function ReorderRules({
  entityId,
  itemId,
  unit,
  hubs,
  initial,
  canWrite,
}: {
  entityId: number;
  itemId: string;
  /** The item's stock unit, as words. */
  unit: string;
  hubs: readonly { id: string; name: string }[];
  initial: ReorderRuleRowDto[];
  canWrite: boolean;
}) {
  const t = useTranslations('inventory.reorderRules');
  const [rules, setRules] = useState(initial);
  const save = useCommand(setReorderRule);
  const remove = useCommand(removeReorderRule);
  const reload = useQuery<ReorderRuleRowDto[]>();
  const failure = save.failure ?? remove.failure ?? reload.failure;

  function refresh() {
    reload.load(() => listReorderRules({ entityId, itemId }), setRules);
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    save.run(
      {
        entityId,
        itemId,
        warehouseId: formText(data, 'warehouseId'),
        reorderLevel: formText(data, 'reorderLevel'),
        reorderQty: formText(data, 'reorderQty'),
      },
      () => {
        toast.success(t('saved'));
        refresh();
      },
    );
  }

  return (
    <section aria-labelledby="reorder-rules" className="flex flex-col gap-3">
      <h2 id="reorder-rules" className="text-h3">
        {t('title')}
      </h2>
      <p className="text-text-muted text-sm">{t('intro')}</p>
      {rules.length === 0 ? (
        <p className="text-text-muted text-sm">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <span>
                {t('rule', {
                  hub: rule.hubName,
                  level: plain(rule.reorderLevel),
                  qty: plain(rule.reorderQty),
                  unit,
                })}
              </span>
              {canWrite ? (
                <Button
                  size="sm"
                  variant="ghost"
                  pending={remove.pending}
                  onClick={() => {
                    remove.run({ ruleId: rule.id }, () => {
                      refresh();
                    });
                  }}
                  aria-label={t('removeLabel', { hub: rule.hubName })}
                >
                  {t('remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="rule-hub" label={t('hub')}>
              <Select name="warehouseId" defaultValue={hubs[0]?.id ?? ''}>
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="rule-level" label={t('level', { unit })}>
              <Input name="reorderLevel" inputMode="decimal" required />
            </Field>
            <Field id="rule-qty" label={t('qty', { unit })}>
              <Input name="reorderQty" inputMode="decimal" required />
            </Field>
          </div>
          <div>
            <Button type="submit" pending={save.pending}>
              {t('save')}
            </Button>
          </div>
        </form>
      ) : null}
      {failure === undefined ? null : <FailureMessage failure={failure} />}
    </section>
  );
}
