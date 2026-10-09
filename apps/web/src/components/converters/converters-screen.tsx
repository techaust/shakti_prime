'use client';

import type { CallerProfilePersonDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  StatusBadge,
  toast,
  useFocusTargets,
  type DataGridColumn,
} from '@shakti/ui';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { saveCallerProfile } from '../../actions/handover';
import { CUSTOMER_LANGUAGES, SEGMENTS } from '../../screens/contract-values';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { useCommand } from '../screens/use-command';

type Language = (typeof CUSTOMER_LANGUAGES)[number];
type Segment = (typeof SEGMENTS)[number];

/**
 * Lead converters (docs/03-roadmap-appendix/phase1.md §8.2, PRD TEL-02): the people of one company who work on
 * leads, each with the switch that makes them a Lead Converter, the most open leads they take and
 * the languages and business lines they take. Presence is the person's own, shown here only.
 */
export function ConvertersScreen({
  initial,
  entityId,
  companies,
}: {
  initial: CallerProfilePersonDto[];
  entityId: number;
  /** The companies the caller may choose between, by id. */
  companies: Record<number, string>;
}) {
  const t = useTranslations('converters');
  const common = useTranslations('common');
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<CallerProfilePersonDto | undefined>(undefined);
  const places = useFocusTargets<string>();

  const columns: DataGridColumn<CallerProfilePersonDto>[] = [
    { id: 'name', header: t('columns.name'), primary: true, cell: (p) => p.name },
    {
      id: 'converter',
      header: t('columns.converter'),
      cell: (p) => (p.isConverter ? t('yes') : t('no')),
    },
    {
      id: 'presence',
      header: t('columns.presence'),
      cell: (p) => (
        <StatusBadge tone={p.presence === 'present' ? 'success' : 'neutral'}>
          {t(p.presence)}
        </StatusBadge>
      ),
    },
    {
      id: 'capacity',
      header: t('columns.capacity'),
      numeric: true,
      cell: (p) => p.maxOpen ?? t('noLimit'),
    },
    {
      id: 'languages',
      header: t('columns.languages'),
      cell: (p) =>
        p.languages.length === 0
          ? t('allLanguages')
          : p.languages.map((l) => t(`language.${l}`)).join(', '),
    },
    {
      id: 'segments',
      header: t('columns.segments'),
      cell: (p) =>
        p.segments.length === 0
          ? t('allSegments')
          : p.segments.map((s) => t(`segment.${s}`)).join(', '),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (p) => (
        <Button
          ref={places.ref(p.userId)}
          variant="ghost"
          size="sm"
          aria-label={t('editLabel', { name: p.name })}
          onClick={() => {
            setEditing(p);
          }}
        >
          {t('edit')}
        </Button>
      ),
    },
  ];

  const ids = Object.keys(companies).map(Number);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {ids.length > 1 ? (
        <div className="max-w-xs">
          <Field id="converters-company" label={t('company')}>
            <Select
              value={String(entityId)}
              onChange={(e) => {
                router.push(`/converters?company=${e.currentTarget.value}` as Route);
              }}
            >
              {ids.map((id) => (
                <option key={id} value={id}>
                  {companies[id]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(p) => p.userId}
        empty={<EmptyState message={t('empty')} />}
      />
      <Dialog
        open={editing !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEditing(undefined);
        }}
      >
        {editing === undefined ? null : (
          <DialogContent
            closeLabel={common('close')}
            returnFocusTo={() => [places.get(editing.userId)]}
          >
            <ProfileForm
              person={editing}
              entityId={entityId}
              onCancel={() => {
                setEditing(undefined);
              }}
              onDone={(saved) => {
                setRows((all) =>
                  all.map((p) =>
                    p.userId === saved.userId
                      ? {
                          ...p,
                          isConverter: saved.isConverter,
                          maxOpen: saved.maxOpen,
                          languages: saved.languages,
                          segments: saved.segments,
                        }
                      : p,
                  ),
                );
                setEditing(undefined);
                toast.success(t('dialog.done', { name: editing.name }));
              }}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function toggled<T extends string>(list: readonly T[], value: T, on: boolean): T[] {
  return on ? [...list.filter((x) => x !== value), value] : list.filter((x) => x !== value);
}

function ProfileForm({
  person,
  entityId,
  onDone,
  onCancel,
}: {
  person: CallerProfilePersonDto;
  entityId: number;
  onDone: (saved: {
    userId: string;
    isConverter: boolean;
    maxOpen: number | null;
    languages: Language[];
    segments: Segment[];
  }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('converters');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(saveCallerProfile);
  const { fieldError, formFailure } = useFieldFailure(failure, ['maxOpen']);
  const [isConverter, setIsConverter] = useState(person.isConverter);
  const [maxOpen, setMaxOpen] = useState(person.maxOpen === null ? '' : String(person.maxOpen));
  const [languages, setLanguages] = useState<Language[]>(person.languages);
  const [segments, setSegments] = useState<Segment[]>(person.segments);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const cap = maxOpen.trim();
    run(
      {
        entityId,
        userId: person.userId,
        isConverter,
        maxOpen: cap === '' ? null : Number(cap),
        languages,
        segments,
      },
      (saved) => {
        onDone(saved);
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('dialog.title', { name: person.name })}</DialogTitle>
        <DialogDescription>{t('dialog.intro')}</DialogDescription>
      </DialogHeader>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-accent size-4"
          checked={isConverter}
          onChange={(e) => {
            setIsConverter(e.currentTarget.checked);
          }}
        />
        {t('dialog.isConverter')}
      </label>
      <Field
        id="converter-max-open"
        label={t('dialog.maxOpen')}
        helper={t('dialog.maxOpenHelper')}
        error={fieldError('maxOpen')}
      >
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          value={maxOpen}
          onChange={(e) => {
            setMaxOpen(e.currentTarget.value);
          }}
        />
      </Field>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{t('dialog.languages')}</legend>
        <p className="text-text-muted text-sm">{t('dialog.takesAllHelper')}</p>
        {CUSTOMER_LANGUAGES.map((language) => (
          <label key={language} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-accent size-4"
              checked={languages.includes(language)}
              onChange={(e) => {
                setLanguages((all) => toggled(all, language, e.currentTarget.checked));
              }}
            />
            {t(`language.${language}`)}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{t('dialog.segments')}</legend>
        <p className="text-text-muted text-sm">{t('dialog.takesAllHelper')}</p>
        {SEGMENTS.map((segment) => (
          <label key={segment} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-accent size-4"
              checked={segments.includes(segment)}
              onChange={(e) => {
                setSegments((all) => toggled(all, segment, e.currentTarget.checked));
              }}
            />
            {t(`segment.${segment}`)}
          </label>
        ))}
      </fieldset>
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={pending}>
          {t('dialog.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
