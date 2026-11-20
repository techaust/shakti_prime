'use client';

import type { CopilotReportDto, CopilotReportItemDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  DateInput,
  EmptyState,
  Field,
  Select,
  StatusBadge,
  type DataGridColumn,
  type StatusTone,
} from '@shakti/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import { copilotReport } from '../../actions/copilot';
import { DateTime } from '../../components/date-time';
import { FailureMessage } from '../../components/screens/failure';
import { formText } from '../../components/screens/form-data';
import { ProposalFigures, SpendPerLead } from '../../components/agents/shadow-pack-figures';
import { useQuery } from '../../components/screens/use-command';
import { customerHref } from '../customers';
import { formatCount } from '../format';
import {
  agreementShare,
  periodProblem,
  sampleHref,
  SHADOW_PAGE_SIZE,
  type PeriodProblem,
} from '../shadow-report';

const AGREEMENT_TONE: Record<CopilotReportItemDto['outcomeAgreement'], StatusTone> = {
  agree: 'success',
  disagree: 'warning',
  pending: 'neutral',
  none: 'neutral',
};

/** One measure's agreement: the share agreed, of how many decided, and what still waits. */
function Agreement({
  name,
  counts,
  extra,
}: {
  name: string;
  counts: { agreed: number; disagreed: number; pending: number };
  extra?: string;
}) {
  const t = useTranslations('agents.copilotReport');
  const share = agreementShare(counts.agreed, counts.disagreed);
  return (
    <li className="border-border bg-surface flex flex-col gap-1 rounded-lg border p-4">
      <p className="font-medium">{name}</p>
      <p className="text-h3">{share === undefined ? t('noneDecided') : `${String(share)}%`}</p>
      <p className="text-text-muted text-sm">
        {t('agreed', {
          agreed: formatCount(counts.agreed),
          decided: formatCount(counts.agreed + counts.disagreed),
        })}
      </p>
      <p className="text-text-muted text-sm">{t('waiting', { count: counts.pending })}</p>
      {extra === undefined ? null : <p className="text-text-muted text-sm">{extra}</p>}
    </li>
  );
}

/**
 * Admin › Agents › Co-pilot report (docs/03-roadmap-appendix/phase2.md §7.3, PRD AI-04): for a
 * company and a period, how often callers agreed with the outcomes the Co-pilot suggested and the
 * details it heard, the runs the checks refused, its suggestions by kind and how they ended, then
 * each call summary beside the outcome the caller saved, newest first.
 */
export function CopilotReportScreen({
  initial,
  companies,
}: {
  initial: CopilotReportDto;
  companies: Record<number, string>;
}) {
  const t = useTranslations('agents.copilotReport');
  const shadow = useTranslations('agents.shadow');
  const agents = useTranslations('agents');
  const facts = useTranslations('qualification.facts');
  const pack = useTranslations('agents.shadowPack');
  const [report, setReport] = useState(initial);
  const [rows, setRows] = useState(initial.items);
  const [from, setFrom] = useState<string | undefined>(initial.from);
  const [to, setTo] = useState<string | undefined>(initial.to);
  const [problem, setProblem] = useState<PeriodProblem | undefined>();
  const [problemFrom, setProblemFrom] = useState<string | undefined>(initial.from);
  const reader = useQuery<CopilotReportDto>();
  const more = useQuery<CopilotReportDto>();
  const wanted = useRef(0);

  const fromProblem =
    problem === 'periodTooLong' || (problem === 'periodMissing' && problemFrom === undefined);
  const toProblem =
    problem === 'periodTooLong' ||
    problem === 'periodReversed' ||
    (problem === 'periodMissing' && problemFrom !== undefined);
  const periodMessage = problem === undefined ? undefined : shadow(`filters.${problem}`);

  function apply(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = periodProblem(from, to);
    setProblem(found);
    setProblemFrom(from);
    if (found !== undefined || from === undefined || to === undefined) return;
    const entityId = Number(formText(new FormData(e.currentTarget), 'company'));
    const ask = (wanted.current += 1);
    reader.load(
      () => copilotReport({ entityId, from, to, limit: SHADOW_PAGE_SIZE }),
      (page) => {
        if (wanted.current !== ask) return;
        setReport(page);
        setRows(page.items);
      },
    );
  }

  function loadMore() {
    const cursor = report.nextCursor;
    if (cursor === null) return;
    const ask = wanted.current;
    more.load(
      () =>
        copilotReport({
          entityId: report.entityId,
          from: report.from,
          to: report.to,
          cursor,
          limit: SHADOW_PAGE_SIZE,
        }),
      (page) => {
        if (wanted.current !== ask) return;
        setReport(page);
        setRows((all) => [...all, ...page.items]);
      },
    );
  }

  const columns: DataGridColumn<CopilotReportItemDto>[] = [
    {
      id: 'when',
      header: t('columns.when'),
      numeric: true,
      cell: (r) => <DateTime value={r.createdAt} />,
    },
    {
      id: 'customer',
      header: t('columns.customer'),
      primary: true,
      cell: (r) =>
        r.accountId !== null && r.customerName !== null ? (
          <Link href={customerHref(r.accountId, report.entityId)}>{r.customerName}</Link>
        ) : (
          <span className="text-text-muted">{shadow('unknownCustomer')}</span>
        ),
    },
    {
      id: 'suggested',
      header: t('columns.suggested'),
      cell: (r) => r.suggestedOutcome ?? t('noSuggestion'),
    },
    {
      id: 'logged',
      header: t('columns.logged'),
      cell: (r) => r.loggedOutcome ?? t('notLogged'),
    },
    {
      id: 'facts',
      header: t('columns.facts'),
      cell: (r) =>
        r.facts.length === 0 ? (
          <span className="text-text-muted">{t('noFacts')}</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {r.facts.map((f) => (
              <li key={f.fact}>
                {f.recorded === null
                  ? t('fact', { fact: facts(f.fact), heard: formatCount(f.heard) })
                  : t('factRecorded', {
                      fact: facts(f.fact),
                      heard: formatCount(f.heard),
                      recorded: formatCount(f.recorded),
                    })}
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: 'agreement',
      header: t('columns.agreement'),
      cell: (r) => (
        <StatusBadge tone={AGREEMENT_TONE[r.outcomeAgreement]}>
          {t(`agreement.${r.outcomeAgreement}`)}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <form
        onSubmit={apply}
        className="border-border bg-surface grid gap-3 rounded-lg border p-4 sm:grid-cols-3 lg:items-start"
        noValidate
      >
        <Field id="copilot-company" label={shadow('filters.company')}>
          <Select name="company" defaultValue={String(initial.entityId)}>
            {Object.entries(companies).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="copilot-from"
          label={shadow('filters.from')}
          helper={shadow('filters.dateHelper')}
          error={fromProblem ? periodMessage : undefined}
        >
          <DateInput
            defaultValue={initial.from}
            onValueChange={setFrom}
            invalid={fromProblem ? true : undefined}
          />
        </Field>
        <Field
          id="copilot-to"
          label={shadow('filters.to')}
          helper={shadow('filters.dateHelper')}
          error={toProblem ? periodMessage : undefined}
          actions={
            <Button type="submit" pending={reader.pending}>
              {shadow('filters.apply')}
            </Button>
          }
        >
          <DateInput
            defaultValue={initial.to}
            onValueChange={setTo}
            invalid={toProblem ? true : undefined}
          />
        </Field>
      </form>
      <FailureMessage failure={reader.failure ?? more.failure} />
      <section aria-labelledby="copilot-summary" className="flex flex-col gap-3">
        <h2 id="copilot-summary" className="text-h3">
          {t('summaryHeading')}
        </h2>
        <p className="text-text-muted text-sm">{t('summaries', { count: report.summaries })}</p>
        {report.shown === 0 ? null : (
          <p className="text-text-muted text-sm">{t('shownLeftOut', { count: report.shown })}</p>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          <Agreement
            name={t('outcomes')}
            counts={report.outcomes}
            extra={t('noOutcome', { count: report.outcomes.none })}
          />
          <Agreement name={t('facts')} counts={report.facts} />
        </ul>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="copilot-refused" className="flex flex-col gap-2">
          <h2 id="copilot-refused" className="text-h3">
            {t('refusedHeading')}
          </h2>
          {report.filtered.length === 0 ? (
            <p className="text-text-muted text-sm">{t('noneRefused')}</p>
          ) : (
            <ul className="text-sm">
              {report.filtered.map((f) => (
                <li key={f.reason}>
                  {shadow('refusedReason', {
                    reason: agents(`filterReason.${f.reason}`),
                    count: f.runs,
                  })}
                </li>
              ))}
            </ul>
          )}
        </section>
        <ProposalFigures
          id="copilot-proposals"
          heading={t('proposalsHeading')}
          proposals={report.proposals}
          compared={report.compared}
        />
      </div>
      <SpendPerLead id="copilot-spend" spend={report.spend}>
        <p className="text-text-muted">{pack('copilotNoHandoff')}</p>
      </SpendPerLead>
      <div>
        <Button asChild variant="secondary">
          <Link href={sampleHref('copilot', report.entityId, report.from, report.to)}>
            {pack('review.open')}
          </Link>
        </Button>
      </div>
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.noteId}
        loading={reader.pending}
        empty={<EmptyState message={t('empty')} />}
        loadMore={
          report.nextCursor === null
            ? undefined
            : { label: shadow('loadMore'), pending: more.pending, onLoadMore: loadMore }
        }
      />
    </div>
  );
}
