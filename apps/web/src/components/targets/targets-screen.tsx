'use client';

import type { TargetDto, TargetMetric, TargetPeriod, TargetsScreenDto } from '@shakti/contracts';
import { Button, EmptyState, Field, Input, Select, toast } from '@shakti/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { setTarget } from '../../actions/targets';
import { formatDate, formatDateTime } from '../../screens/format';
import { TARGET_METRICS, TARGET_PERIODS } from '../../screens/contract-values';
import { metricNumber, parseSubject, parseTargetValue, subjectValue } from '../../screens/home';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/**
 * The Targets page (PRD TEL-06): a form to set the target of a caller or a team for a metric and a
 * period, the targets in force today, and the history of every target set. A target holds from the
 * period it starts in until a newer one is set; 0 takes it away. The figures are the client's:
 * nothing is filled in, so the page starts empty.
 */
export function TargetsScreen({ data }: { data: TargetsScreenDto }) {
  return (
    <div className="flex flex-col gap-8">
      <SetTargetForm data={data} />
      <CurrentTargets data={data} />
      <History data={data} />
    </div>
  );
}

const FORM_ID = 'set-target';

function SetTargetForm({ data }: { data: TargetsScreenDto }) {
  const t = useTranslations('targets.form');
  const metrics = useTranslations('targets.metric');
  const periods = useTranslations('targets.period');
  const router = useRouter();
  const { run, pending, failure } = useCommand(setTarget);
  const { fieldError, formFailure } = useFieldFailure(failure, [
    'subjectId',
    'metric',
    'period',
    'startsOn',
    'value',
  ]);
  const [period, setPeriod] = useState<TargetPeriod>('day');
  const [problem, setProblem] = useState<'subject' | 'value' | undefined>();
  const teams = data.subjects.filter((s) => s.scope === 'team');
  const callers = data.subjects.filter((s) => s.scope === 'caller');

  if (data.subjects.length === 0) return <EmptyState message={t('noSubjects')} />;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    const subject = parseSubject(formText(form, 'subject'));
    const value = parseTargetValue(formText(form, 'value'));
    if (subject === undefined) {
      setProblem('subject');
      return;
    }
    if (value === undefined) {
      setProblem('value');
      return;
    }
    setProblem(undefined);
    const chosenPeriod = formText(form, 'period') as TargetPeriod;
    const startsOn =
      formText(form, 'from') === 'next'
        ? data.nextStarts[chosenPeriod]
        : data.periodStarts[chosenPeriod];
    run(
      {
        entityId: data.entityId,
        scope: subject.scope,
        subjectId: subject.id,
        metric: formText(form, 'metric') as TargetMetric,
        period: chosenPeriod,
        startsOn,
        value,
      },
      () => {
        toast.success(value === 0 ? t('removed') : t('saved'));
        router.refresh();
      },
    );
  }

  return (
    <section aria-labelledby={`${FORM_ID}-heading`} className="flex flex-col gap-3">
      <h2 id={`${FORM_ID}-heading`} className="text-h3">
        {t('heading')}
      </h2>
      <form
        onSubmit={submit}
        noValidate
        className="bg-surface border-border grid grid-cols-1 gap-4 rounded-lg border p-4 md:grid-cols-2 lg:grid-cols-3"
      >
        <Field
          id={`${FORM_ID}-subject`}
          label={t('subject')}
          error={problem === 'subject' ? t('subjectMissing') : fieldError('subjectId')}
        >
          <Select name="subject" defaultValue="">
            <option value="" disabled>
              {t('subjectChoose')}
            </option>
            {teams.length === 0 ? null : (
              <optgroup label={t('teams')}>
                {teams.map((s) => (
                  <option key={s.id} value={subjectValue('team', s.id)}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
            {callers.length === 0 ? null : (
              <optgroup label={t('callers')}>
                {callers.map((s) => (
                  <option key={s.id} value={subjectValue('caller', s.id)}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Field id={`${FORM_ID}-metric`} label={t('metric')} error={fieldError('metric')}>
          <Select name="metric" defaultValue="calls">
            {TARGET_METRICS.map((m) => (
              <option key={m} value={m}>
                {metrics(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${FORM_ID}-period`} label={t('period')} error={fieldError('period')}>
          <Select
            name="period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as TargetPeriod)}
          >
            {TARGET_PERIODS.map((p) => (
              <option key={p} value={p}>
                {periods(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={`${FORM_ID}-from`}
          label={t('from')}
          helper={t('fromHelper')}
          error={fieldError('startsOn')}
        >
          <Select name="from" defaultValue="this">
            <option value="this">
              {t(`thisPeriod.${period}`, { date: formatDate(data.periodStarts[period]) })}
            </option>
            <option value="next">
              {t(`nextPeriod.${period}`, { date: formatDate(data.nextStarts[period]) })}
            </option>
          </Select>
        </Field>
        <Field
          id={`${FORM_ID}-value`}
          label={t('value')}
          helper={t('valueHelper')}
          error={problem === 'value' ? t('valueInvalid') : fieldError('value')}
        >
          <Input name="value" inputMode="decimal" autoComplete="off" maxLength={10} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" pending={pending}>
            {t('save')}
          </Button>
        </div>
        <div className="md:col-span-2 lg:col-span-3">
          <FailureMessage failure={formFailure} />
        </div>
      </form>
    </section>
  );
}

function TargetRows({ rows, withSetBy }: { rows: readonly TargetDto[]; withSetBy: boolean }) {
  const t = useTranslations('targets.table');
  const metrics = useTranslations('targets.metric');
  const periods = useTranslations('targets.period');
  return (
    <>
      {rows.map((r) => (
        <tr key={r.id} className="border-border border-t">
          <th scope="row" className="px-3 py-2 text-left font-medium">
            {r.subjectName ?? t('unknownPerson')}
            <span className="text-text-muted block text-xs font-normal">
              {t(`scope.${r.scope}`)}
            </span>
          </th>
          <td className="px-3 py-2">{metrics(r.metric)}</td>
          <td className="px-3 py-2">{periods(r.period)}</td>
          <td className="px-3 py-2">{formatDate(r.startsOn)}</td>
          <td className="px-3 py-2 text-right tabular-nums">
            {r.value === 0 ? t('removedValue') : metricNumber(r.metric, r.value)}
          </td>
          {withSetBy ? (
            <td className="px-3 py-2">
              {t('setBy', {
                name: r.setByName ?? t('unknownPerson'),
                time: formatDateTime(r.setAt),
              })}
            </td>
          ) : null}
        </tr>
      ))}
    </>
  );
}

function Table({
  caption,
  rows,
  withSetBy,
}: {
  caption: string;
  rows: readonly TargetDto[];
  withSetBy: boolean;
}) {
  const t = useTranslations('targets.table');
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="border-border bg-surface overflow-x-auto rounded-lg border"
    >
      <table className="w-full min-w-xl text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-2 text-text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {t('subject')}
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {t('metric')}
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {t('period')}
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {t('from')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('value')}
            </th>
            {withSetBy ? (
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {t('setByHeading')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          <TargetRows rows={rows} withSetBy={withSetBy} />
        </tbody>
      </table>
    </div>
  );
}

function CurrentTargets({ data }: { data: TargetsScreenDto }) {
  const t = useTranslations('targets.current');
  return (
    <section aria-labelledby="targets-current" className="flex flex-col gap-3">
      <h2 id="targets-current" className="text-h3">
        {t('heading')}
      </h2>
      {data.current.length === 0 ? (
        <EmptyState message={t('empty')} />
      ) : (
        <Table caption={t('caption')} rows={data.current} withSetBy />
      )}
    </section>
  );
}

function History({ data }: { data: TargetsScreenDto }) {
  const t = useTranslations('targets.history');
  return (
    <section aria-labelledby="targets-history" className="flex flex-col gap-3">
      <h2 id="targets-history" className="text-h3">
        {t('heading')}
      </h2>
      <p className="text-text-muted">{t('intro')}</p>
      {data.history.length === 0 ? (
        <EmptyState message={t('empty')} />
      ) : (
        <Table caption={t('caption')} rows={data.history} withSetBy />
      )}
    </section>
  );
}
