'use client';

import type { ItemDto, ItemPageDto } from '@shakti/contracts';
import { Button, Field, Input } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { listItems } from '../../../actions/catalogue';
import { FailureMessage } from '../../screens/failure';
import { useQuery } from '../../screens/use-command';

/** The items a search shows at most. */
const RESULTS = 10;

/**
 * Finds an item of the catalogue by part of its code or name and hands the one chosen to
 * `onChoose`; for the count's chosen items, and for stock a counter finds where none was listed.
 */
export function ItemFinder({
  id,
  onChoose,
  chooseLabel,
}: {
  id: string;
  onChoose: (item: ItemDto) => void;
  /** The words of the button on each item found, such as "Add {name}". */
  chooseLabel: (item: ItemDto) => string;
}) {
  const t = useTranslations('inventory.counts.findItem');
  const [text, setText] = useState('');
  const [found, setFound] = useState<ItemDto[] | undefined>();
  const { load, pending, failure } = useQuery<ItemPageDto>();

  function search() {
    const q = text.trim();
    if (q === '') return;
    load(
      () => listItems({ q: q.slice(0, 80), limit: RESULTS }),
      (page) => {
        setFound(page.items.filter((i) => i.isActive));
      },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Field
        id={id}
        label={t('label')}
        helper={t('helper')}
        actions={
          <Button type="button" variant="secondary" pending={pending} onClick={search}>
            {t('search')}
          </Button>
        }
      >
        <Input
          value={text}
          autoComplete="off"
          maxLength={80}
          onChange={(e) => {
            setText(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              search();
            }
          }}
        />
      </Field>
      <FailureMessage failure={failure} />
      {found === undefined ? null : found.length === 0 ? (
        <p role="status" className="text-text-muted text-sm">
          {t('none')}
        </p>
      ) : (
        <ul aria-label={t('results')} className="flex flex-col gap-1">
          {found.map((item) => (
            <li
              key={item.id}
              className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate">{item.name}</span>
                <span className="text-text-muted block text-sm">{item.sku}</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label={chooseLabel(item)}
                onClick={() => {
                  onChoose(item);
                }}
              >
                {t('add')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
