'use client';

import type {
  ConciergeDraftState,
  ConciergeReportDto,
  ConciergeReportItemDto,
} from '@shakti/contracts';
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
import { conciergeReport } from '../../actions/concierge';
import { DateTime } from '../../components/date-time';
import { FailureMessage } from '../../components/screens/failure';
import { formText } from '../../components/screens/form-data';
import {
  HandoffCounts,
  ProposalFigures,
  SpendPerLead,
} from '../../components/agents/shadow-pack-figures';
import { useQuery } from '../../components/screens/use-command';
import { customerHref } from '../customers';
import { periodProblem, sampleHref, SHADOW_PAGE_SIZE, type PeriodProblem } from '../shadow-report';

const STATE_TONE: Record<ConciergeDraftState, StatusTone> = {
  shadowed: 'neutral',
  waiting: 'accent',
  sent: 'success',
  edited: 'success',
  discarded: 'warning',
};

/**
 * Admin › Agents › WhatsApp drafts (docs/03-roadmap-appendix/phase2.md §7.2, PRD AI-04):
 * for a company and a period, how many replies the WhatsApp Concierge drafted and how they ended,
 * the runs the checks refused, its suggestions by kind, then every draft beside the customer's
 * message it answered and what a member of the team sent, newest first. The customer's words are
 * shown as stored, masked.
 */
export function ConciergeReportScreen({
  initial,
  companies,
}: {
  initial: ConciergeReportDto;
  companies: Record<number, string>;
}) {
  const t = useTranslations('agents.conciergeReport');
  const shadow = useTranslations('agents.shadow');
  const agents = useTranslations('agents');
  const pack = useTranslations('agents.shadowPack');
  const [report, setReport] = useState(initial);
  const [rows, setRows] = useState(initial.items);
  const [from, setFrom] = useState<string | undefined>(initial.from);
  const [to, setTo] = useState<string | undefined>(initial.to);
  const [problem, setProblem] = useState<PeriodProblem | undefined>();
  const [problemFrom, setProblemFrom] = useState<string | undefined>(initial.from);
  const reader = useQuery<ConciergeReportDto>();
  const more = useQuery<ConciergeReportDto>();
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
      () => conciergeReport({ entityId, from, to, limit: SHADOW_PAGE_SIZE }),
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
        conciergeReport({
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

  const columns: DataGridColumn<ConciergeReportItemDto>[] = [
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
        r.customerName === null ? (
          <span className="text-text-muted">{shadow('unknownCustomer')}</span>
        ) : (
          <Link href={customerHref(r.accountId, report.entityId)}>{r.customerName}</Link>
        ),
    },
    {
      id: 'asked',
      header: t('columns.asked'),
      cell: (r) => (
        <span className="whitespace-pre-wrap">
          {r.asked ?? <span className="text-text-muted">{t('file')}</span>}
        </span>
      ),
    },
    {
      id: 'draft',
      header: t('columns.draft'),
      cell: (r) => <span className="whitespace-pre-wrap">{r.draft}</span>,
    },
    {
      id: 'sent',
      header: t('columns.sent'),
      cell: (r) =>
        r.sent === null ? (
          <span className="text-text-muted">{t('nothingSent')}</span>
        ) : (
          <span className="flex flex-col gap-1">
            <span className="whitespace-pre-wrap">
              {r.sent.body ?? t('template', { name: r.sent.templateLabel ?? '' })}
            </span>
            {r.sent.fromDraft ? (
              <span className="text-text-muted text-xs">{t('fromDraft')}</span>
            ) : null}
          </span>
        ),
    },
    {
      id: 'state',
      header: t('columns.state'),
      cell: (r) => <StatusBadge tone={STATE_TONE[r.state]}>{t(`state.${r.state}`)}</StatusBadge>,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <form
        onSubmit={apply}
        className="border-border bg-surface grid gap-3 rounded-lg border p-4 sm:grid-cols-3 lg:items-start"
        noValidate
      >
        <Field id="concierge-company" label={shadow('filters.company')}>
          <Select name="company" defaultValue={String(initial.entityId)}>
            {Object.entries(companies).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="concierge-from"
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
          id="concierge-to"
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
      <section
        aria-labelledby="concierge-summary"
        className="flex flex-col gap-2"
        data-testid="concierge-summary"
      >
        <h2 id="concierge-summary" className="text-h3">
          {t('summaryHeading')}
        </h2>
        <p className="text-sm">{t('drafts', { count: report.drafts.total })}</p>
        <p className="text-text-muted text-sm">{t('states', report.drafts)}</p>
        <p className="text-text-muted text-sm">
          {t('answered', { count: report.drafts.answered })}
        </p>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="concierge-refused" className="flex flex-col gap-2">
          <h2 id="concierge-refused" className="text-h3">
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
          id="concierge-proposals"
          heading={t('proposalsHeading')}
          proposals={report.proposals}
          compared={report.compared}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SpendPerLead id="concierge-spend" spend={report.spend} />
        <HandoffCounts id="concierge-handoffs" handoffs={report.handoffs} />
      </div>
      <div>
        <Button asChild variant="secondary">
          <Link href={sampleHref('concierge', report.entityId, report.from, report.to)}>
            {pack('review.open')}
          </Link>
        </Button>
      </div>
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.actionId}
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
