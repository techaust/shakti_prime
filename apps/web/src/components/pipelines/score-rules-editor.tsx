'use client';

import type {
  LeadSourceDto,
  ScoreFactor,
  ScoreRuleDto,
  Segment,
  SystemSizeUnit,
} from '@shakti/contracts';
import { Button, EmptyState, Field, Input, Select, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { listScoreRules, setScoreRules } from '../../actions/crm-settings';
import {
  SCORE_FACTORS,
  SCORE_POINTS_LIMIT,
  SEGMENTS,
  SYSTEM_SIZE_UNITS,
} from '../../screens/contract-values';
import {
  emptyRule,
  ruleDraft,
  scopeOf,
  scoreRulesInput,
  type RuleDraft,
} from '../../screens/pipeline-settings';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import type { CompanyChoice } from './pipeline-settings-screen';
import { ScopePicker, type ScopeValue } from './scope-picker';

const checkbox = 'accent-accent size-4 shrink-0 cursor-pointer';

/**
 * The lead score rules of one scope, edited as a list and saved as a set (`crm.score_rule.set`),
 * which scores the scope's open leads again in the same change.
 */
export function ScoreRulesEditor({
  companies,
  sources,
  initial,
}: {
  companies: CompanyChoice[];
  sources: LeadSourceDto[];
  initial: ScoreRuleDto[];
}) {
  const t = useTranslations('pipelineSettings');
  const [scope, setScope] = useState<ScopeValue>({ company: 'group', segment: 'all' });
  const [drafts, setDrafts] = useState<RuleDraft[]>(() => initial.map(ruleDraft));
  const read = useQuery<ScoreRuleDto[]>();
  const save = useCommand(setScoreRules);

  function choose(next: ScopeValue) {
    setScope(next);
    read.load(
      () => listScoreRules(scopeOf(next.company, next.segment)),
      (rules) => {
        setDrafts(rules.map(ruleDraft));
      },
    );
  }

  function change(rowId: string, patch: Partial<RuleDraft>) {
    setDrafts((all) => all.map((d) => (d.rowId === rowId ? { ...d, ...patch } : d)));
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.pending || read.pending) return;
    save.run(scoreRulesInput(scopeOf(scope.company, scope.segment), drafts), (list) => {
      setDrafts(list.rules.map(ruleDraft));
      toast.success(t('rulesSaved', { count: list.rescored }));
    });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4 sm:p-5"
    >
      <ScopePicker idPrefix="rules" companies={companies} value={scope} onChange={choose} />
      <FailureMessage failure={read.failure} />
      {drafts.length === 0 ? (
        <EmptyState message={t('rulesEmpty')} />
      ) : (
        <ol className="flex flex-col gap-3" aria-busy={read.pending || undefined}>
          {drafts.map((d, i) => (
            <li key={d.rowId}>
              <RuleRow
                draft={d}
                number={i + 1}
                sources={sources}
                onChange={(patch) => {
                  change(d.rowId, patch);
                }}
                onRemove={() => {
                  setDrafts((all) => all.filter((x) => x.rowId !== d.rowId));
                  const next = drafts[i + 1] ?? drafts[i - 1];
                  setTimeout(() => {
                    document
                      .getElementById(
                        next === undefined ? 'rules-add' : `rule-${next.rowId}-factor`,
                      )
                      ?.focus();
                  });
                }}
              />
            </li>
          ))}
        </ol>
      )}
      <FailureMessage failure={save.failure} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button
          id="rules-add"
          type="button"
          variant="secondary"
          disabled={read.pending}
          onClick={() => {
            const rowId = crypto.randomUUID();
            setDrafts((all) => [...all, emptyRule(rowId)]);
            setTimeout(() => {
              document.getElementById(`rule-${rowId}-factor`)?.focus();
            });
          }}
        >
          {t('addRule')}
        </Button>
        <Button type="submit" pending={save.pending} disabled={read.pending}>
          {t('saveRules')}
        </Button>
      </div>
    </form>
  );
}

function toggle<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item);
}

function RuleRow({
  draft: d,
  number,
  sources,
  onChange,
  onRemove,
}: {
  draft: RuleDraft;
  number: number;
  sources: LeadSourceDto[];
  onChange: (patch: Partial<RuleDraft>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('pipelineSettings');
  const activity = useTranslations('activity');
  const id = (part: string) => `rule-${d.rowId}-${part}`;
  const legend = t('ruleLegend', { position: number });
  return (
    <fieldset className="border-border flex flex-col gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-semibold">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field id={id('factor')} label={t('ruleFactor')}>
          <Select
            value={d.factor}
            onChange={(e) => {
              onChange({ factor: e.currentTarget.value as ScoreFactor });
            }}
          >
            {SCORE_FACTORS.map((factor) => (
              <option key={factor} value={factor}>
                {t(`factor.${factor}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={id('points')} label={t('rulePoints')} helper={t('pointsHelper')}>
          <Input
            type="number"
            inputMode="numeric"
            min={-SCORE_POINTS_LIMIT}
            max={SCORE_POINTS_LIMIT}
            value={d.points}
            onChange={(e) => {
              onChange({ points: e.currentTarget.value });
            }}
          />
        </Field>
      </div>

      {d.factor === 'source' ? (
        <Choices
          legend={t('sources')}
          items={sources.map((s) => ({ value: s.code, label: s.name }))}
          chosen={d.sourceCodes}
          onToggle={(code, on) => {
            onChange({ sourceCodes: toggle(d.sourceCodes, code, on) });
          }}
        />
      ) : null}
      {d.factor === 'segment' ? (
        <Choices
          legend={t('segments')}
          items={SEGMENTS.map((s) => ({ value: s, label: activity(`values.segment.${s}`) }))}
          chosen={d.segments}
          onToggle={(segment, on) => {
            onChange({ segments: toggle(d.segments, segment as Segment, on) });
          }}
        />
      ) : null}
      {d.factor === 'district' ? (
        <Field id={id('districts')} label={t('districts')} helper={t('districtsHelper')}>
          <Input
            value={d.districts}
            maxLength={2000}
            autoComplete="off"
            onChange={(e) => {
              onChange({ districts: e.currentTarget.value });
            }}
          />
        </Field>
      ) : null}
      {d.factor === 'system_size' || d.factor === 'age_days' ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {d.factor === 'system_size' ? (
            <Field id={id('unit')} label={t('unit')}>
              <Select
                value={d.unit}
                onChange={(e) => {
                  onChange({ unit: e.currentTarget.value as SystemSizeUnit });
                }}
              >
                {SYSTEM_SIZE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit === 'kw' ? t('unitKw') : t('unitHp')}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field
            id={id('min')}
            label={d.factor === 'age_days' ? t('ageFrom') : t('sizeFrom')}
            helper={t('rangeHelper')}
          >
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={d.min}
              onChange={(e) => {
                onChange({ min: e.currentTarget.value });
              }}
            />
          </Field>
          <Field id={id('max')} label={d.factor === 'age_days' ? t('ageTo') : t('sizeTo')}>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={d.max}
              onChange={(e) => {
                onChange({ max: e.currentTarget.value });
              }}
            />
          </Field>
        </div>
      ) : null}
      {d.factor === 'system_size' ? (
        <p className="text-text-muted text-sm">{t('sizeNotRecorded')}</p>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          aria-label={t('removeLabel', { name: legend })}
          onClick={onRemove}
        >
          {t('remove')}
        </Button>
      </div>
    </fieldset>
  );
}

function Choices({
  legend,
  items,
  chosen,
  onToggle,
}: {
  legend: string;
  items: { value: string; label: string }[];
  chosen: readonly string[];
  onToggle: (value: string, on: boolean) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-text-muted mb-1 text-sm font-medium">{legend}</legend>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {items.map((item) => (
          <label key={item.value} className="flex min-h-8 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className={checkbox}
              checked={chosen.includes(item.value)}
              onChange={(e) => {
                onToggle(item.value, e.currentTarget.checked);
              }}
            />
            {item.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
