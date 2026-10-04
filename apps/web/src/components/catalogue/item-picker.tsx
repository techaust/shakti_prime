'use client';

import type { ItemDto, ItemPageDto } from '@shakti/contracts';
import { Button, Field, Input } from '@shakti/ui';
import { useEffect, useRef, useState } from 'react';
import { listItems } from '../../actions/catalogue';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';

/**
 * Finds an item still sold by part of its name or code and offers the first few to choose, for
 * the kit form and the GST rate form. The words come from the form that uses it.
 */
export function ItemPicker({
  id,
  label,
  helper,
  noneFound,
  chooseLabel,
  chooseFor,
  exclude = [],
  onChoose,
}: {
  id: string;
  label: string;
  helper: string;
  noneFound: string;
  /** The button's words, such as "Add". */
  chooseLabel: string;
  /** The button's accessible name for one item, such as "Add Submersible pump 5 HP". */
  chooseFor: (item: ItemDto) => string;
  exclude?: readonly string[];
  onChoose: (item: ItemDto) => void;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<ItemDto[] | undefined>();
  const { load, failure } = useQuery<ItemPageDto>();
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const asked = useRef('');
  useEffect(
    () => () => {
      clearTimeout(typing.current);
    },
    [],
  );

  function search(text: string) {
    setQ(text);
    clearTimeout(typing.current);
    const wanted = text.trim();
    if (wanted.length < 2) {
      setFound(undefined);
      return;
    }
    typing.current = setTimeout(() => {
      asked.current = wanted;
      load(
        () => listItems({ q: wanted, limit: 8 }),
        (page) => {
          if (asked.current === wanted) setFound(page.items);
        },
      );
    }, 250);
  }

  const shown = found?.filter((i) => !exclude.includes(i.id));
  return (
    <div className="flex flex-col gap-2">
      <Field id={id} label={label} helper={helper}>
        <Input
          type="search"
          autoComplete="off"
          value={q}
          onChange={(e) => {
            search(e.currentTarget.value);
          }}
        />
      </Field>
      <FailureMessage failure={failure} />
      {shown === undefined ? null : shown.length === 0 ? (
        <p className="text-text-muted" role="status">
          {noneFound}
        </p>
      ) : (
        <ul className="border-border flex flex-col rounded-md border" aria-live="polite">
          {shown.map((item) => (
            <li
              key={item.id}
              className="border-border flex items-center justify-between gap-3 border-t px-3 py-2 first:border-t-0"
            >
              <span className="min-w-0">
                <span className="block break-words">{item.name}</span>
                <span className="text-text-muted block text-sm">{item.sku}</span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                aria-label={chooseFor(item)}
                onClick={() => {
                  onChoose(item);
                  setQ('');
                  setFound(undefined);
                }}
              >
                {chooseLabel}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
