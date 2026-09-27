'use client';

import { useState, type ComponentProps } from 'react';
import { formatDmy, maskDmy, parseDmy } from './date';
import { Input } from './input';

export interface DateInputProps extends Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type'
> {
  /** The starting date as `YYYY-MM-DD`. */
  defaultValue?: string;
  /** Called with `YYYY-MM-DD` once a real date is typed, and with undefined otherwise. */
  onValueChange?: (iso: string | undefined) => void;
  invalid?: boolean | undefined;
}

/**
 * A date typed as DD-MM-YYYY (DESIGN.md §6, §9), with the dashes put in while typing. The form
 * receives the ISO date under `name` from a hidden input, so a server action never parses the
 * Indian form; an incomplete or impossible date sends an empty value.
 */
export function DateInput({
  name,
  defaultValue,
  onValueChange,
  invalid,
  ...props
}: DateInputProps) {
  const [text, setText] = useState(() => formatDmy(defaultValue));
  const iso = parseDmy(text);
  return (
    <>
      <Input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        pattern="\d{2}-\d{2}-\d{4}"
        maxLength={10}
        value={text}
        invalid={invalid ?? (text.length === 10 && iso === undefined ? true : undefined)}
        onChange={(e) => {
          const next = maskDmy(e.currentTarget.value);
          setText(next);
          onValueChange?.(parseDmy(next));
        }}
      />
      {name === undefined ? null : <input type="hidden" name={name} value={iso ?? ''} />}
    </>
  );
}
