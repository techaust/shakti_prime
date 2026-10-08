'use client';

import type { SizingDto, SizingKind, SizingPumpDto, StaleSizingDto } from '@shakti/contracts';
import { Button, EmptyState, Field, Input, Select, Skeleton, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { recordSizing, sizingPanelData, type SizingPanelData } from '../../actions/sizing';
import {
  PIPE_MATERIALS,
  PUMP_DRIVES,
  PUMP_TYPES,
  SIZING_INPUT_LIMITS,
  SIZING_KINDS,
} from '../../screens/contract-values';
import {
  buildSizingInput,
  isStale,
  nextTab,
  PUMP_MEASUREMENTS,
  sizingFields,
} from '../../screens/sizing';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';
import { SizingResult } from './sizing-result';

interface Lead {
  entityId: number;
  opportunityId: string;
}

type Latest = Record<SizingKind, SizingDto | StaleSizingDto | null>;

/** The value a field opens with: the measurement of the lead's newest sizing of that kind. */
function previous(sizing: SizingDto | null, name: string): string {
  const value = (sizing?.inputs as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
}

/** The form of one kind of sizing, opening with the lead's newest measurements. */
function SizingForm({
  kind,
  lead,
  latest,
  pumps,
  onSaved,
}: {
  kind: SizingKind;
  lead: Lead;
  latest: SizingDto | null;
  pumps: SizingPumpDto[];
  onSaved: (sizing: SizingDto) => void;
}) {
  const t = useTranslations('sizing');
  const { run, pending, failure } = useCommand(recordSizing);
  const { fieldError, formFailure } = useFieldFailure(failure, sizingFields(kind));
  const id = useId();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    run(
      buildSizingInput(kind, lead, (name) => formText(data, name)),
      (saved) => {
        toast.success(t('done'));
        onSaved(saved);
      },
    );
  }

  const measurement = (name: keyof typeof SIZING_INPUT_LIMITS, label: string, helper?: string) => (
    <Field
      key={name}
      id={`${id}-${name}`}
      label={label}
      helper={helper}
      error={fieldError(`sizing.inputs.${name}`)}
    >
      <Input
        name={name}
        type="number"
        step="any"
        inputMode="decimal"
        autoComplete="off"
        required
        defaultValue={previous(latest, name)}
        min={SIZING_INPUT_LIMITS[name].min}
        max={SIZING_INPUT_LIMITS[name].max}
      />
    </Field>
  );

  const choice = (
    name: 'pumpType' | 'drive' | 'pipeMaterial',
    label: string,
    options: readonly { value: string; label: string }[],
  ) => (
    <Field id={`${id}-${name}`} label={label} error={fieldError(`sizing.inputs.${name}`)}>
      <Select name={name} required defaultValue={previous(latest, name) || options[0]?.value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-4">
        <legend className="text-h3 mb-2">
          {t(kind === 'pump' ? 'pump.legend' : 'rooftop.legend')}
        </legend>
        {kind === 'pump' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {choice(
                'pumpType',
                t('pump.pumpType'),
                PUMP_TYPES.map((value) => ({ value, label: t(`pump.pumpTypes.${value}`) })),
              )}
              {choice(
                'drive',
                t('pump.drive'),
                PUMP_DRIVES.map((value) => ({ value, label: t(`pump.drives.${value}`) })),
              )}
              {choice(
                'pipeMaterial',
                t('pump.pipeMaterial'),
                PIPE_MATERIALS.map((value) => ({ value, label: t(`pump.pipeMaterials.${value}`) })),
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {PUMP_MEASUREMENTS.map((name) =>
                measurement(
                  name,
                  t(`pump.${name}`),
                  name === 'staticLevelM' ? t('pump.staticLevelHelper') : undefined,
                ),
              )}
            </div>
            <Field
              id={`${id}-itemId`}
              label={t('pump.item')}
              helper={t('pump.itemHelper')}
              error={fieldError('sizing.itemId')}
            >
              <Select
                name="itemId"
                defaultValue={latest?.kind === 'pump' ? (latest.itemId ?? '') : ''}
              >
                <option value="">{t('pump.itemNone')}</option>
                {pumps.map((pump) => (
                  <option key={pump.id} value={pump.id}>
                    {pump.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {measurement(
              'monthlyUnitsKwh',
              t('rooftop.monthlyUnitsKwh'),
              t('rooftop.monthlyUnitsHelper'),
            )}
            {measurement('roofAreaSqm', t('rooftop.roofAreaSqm'))}
            {measurement(
              'sanctionedLoadKw',
              t('rooftop.sanctionedLoadKw'),
              t('rooftop.sanctionedLoadHelper'),
            )}
          </div>
        )}
      </fieldset>
      <FailureMessage failure={formFailure} />
      <div className="flex justify-end">
        <Button type="submit" pending={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}

/**
 * The sizing panel of a lead (docs/03-roadmap-appendix/phase1.md §6.7): a pump tab and a rooftop tab, each with
 * the measurements to enter and the newest result, worked out on the server. Keyboard first: the
 * tabs move with the arrow keys, Home and End, and each form submits with Enter. A person who may
 * read the lead but not change it sees the results only.
 */
export function SizingPanel({
  entityId,
  opportunityId,
  canWrite,
  onSaved,
}: Lead & {
  /** The caller may write the lead (`crm.lead.write`); the server decides again on save. */
  canWrite: boolean;
  /** Told of each sizing saved, so the page around the panel can read its history again. */
  onSaved?: (sizing: SizingDto) => void;
}) {
  const t = useTranslations('sizing');
  const id = useId();
  const { load, pending, failure } = useQuery<SizingPanelData>();
  const [data, setData] = useState<{ latest: Latest; pumps: SizingPumpDto[] } | undefined>();
  const [tab, setTab] = useState<SizingKind>('pump');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const lead = { entityId, opportunityId };

  useEffect(() => {
    load(
      () => sizingPanelData({ entityId, opportunityId }),
      (answer) => {
        setData({ latest: { pump: answer.pump, rooftop: answer.rooftop }, pumps: answer.pumps });
      },
    );
  }, [load, entityId, opportunityId]);

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const index = SIZING_KINDS.indexOf(tab);
    const next = nextTab(index, e.key, SIZING_KINDS.length);
    const kind = next === undefined ? undefined : SIZING_KINDS[next];
    if (next === undefined || kind === undefined) return;
    e.preventDefault();
    setTab(kind);
    tabs.current[next]?.focus();
  }

  const latest = data?.latest[tab] ?? null;
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h3 id={`${id}-title`} className="text-h3">
          {t('title')}
        </h3>
        <p className="text-text-muted text-sm">{t('intro')}</p>
      </header>
      <div role="tablist" aria-label={t('tabsLabel')} className="border-border flex gap-1 border-b">
        {SIZING_KINDS.map((kind, index) => (
          <button
            key={kind}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${kind}`}
            aria-selected={tab === kind}
            aria-controls={`${id}-panel-${kind}`}
            tabIndex={tab === kind ? 0 : -1}
            onClick={() => {
              setTab(kind);
            }}
            onKeyDown={onTabKey}
            className={
              tab === kind
                ? 'border-accent text-text -mb-px h-control border-b-2 px-3 font-medium'
                : 'text-text-muted hover:text-text -mb-px h-control border-b-2 border-transparent px-3'
            }
          >
            {t(`kind.${kind}`)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-${tab}`}
        aria-labelledby={`${id}-tab-${tab}`}
        className="flex flex-col gap-6"
      >
        {data === undefined ? (
          failure === undefined || pending ? (
            <div aria-busy="true" aria-label={t('loading')} className="flex flex-col gap-3">
              <Skeleton className="h-control w-full" />
              <Skeleton className="h-control w-full" />
              <Skeleton className="h-control w-2/3" />
            </div>
          ) : (
            <FailureMessage failure={failure} />
          )
        ) : (
          <>
            {canWrite ? (
              <SizingForm
                key={`${tab}-${latest?.id ?? 'none'}`}
                kind={tab}
                lead={lead}
                latest={latest === null || isStale(latest) ? null : latest}
                pumps={data.pumps}
                onSaved={(saved) => {
                  setData((was) =>
                    was === undefined
                      ? was
                      : { ...was, latest: { ...was.latest, [saved.kind]: saved } },
                  );
                  onSaved?.(saved);
                }}
              />
            ) : (
              <p className="text-text-muted text-sm">{t('readOnly')}</p>
            )}
            {latest === null ? (
              <EmptyState message={t('empty')} />
            ) : isStale(latest) ? (
              <EmptyState message={t('stale')} />
            ) : (
              <SizingResult sizing={latest} />
            )}
          </>
        )}
      </div>
    </section>
  );
}
