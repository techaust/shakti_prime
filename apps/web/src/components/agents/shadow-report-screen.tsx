'use client';

import type {
  ShadowKindSummaryDto,
  ShadowProposalDto,
  ShadowReportDto,
  TriageProposalKind,
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
import { shadowReport } from '../../actions/agents';
import { oneOf } from '../../screens/audit';
import { SEGMENTS } from '../../screens/contract-values';
import { customerHref } from '../../screens/customers';
import { formatCount } from '../../screens/format';
import {
  agreementShare,
  periodProblem,
  SHADOW_PAGE_SIZE,
  signedPoints,
  type PeriodProblem,
} from '../../screens/shadow-report';
import { DateTime } from '../date-time';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useQuery } from '../screens/use-command';

const AGREEMENT_TONE: Record<ShadowProposalDto['agreement'], StatusTone> = {
  agree: 'success',
  disagree: 'warning',
  pending: 'neutral',
};

/**
 * Admin › Agents › Triage proposals (docs/03-roadmap-appendix/phase1.md §9, A1): for a company and a
 * period, how often people agreed with each kind of proposal and the ones the checks refused, then
 * each proposal beside what people did with the lead, newest first, a page at a time. The
 * customer's name shows only where the viewer may read it.
 */
export function ShadowReportScreen({
  initial,
  companies,
}: {
  initial: ShadowReportDto;
  companies: Record<number, string>;
}) {
  const t = useTranslations('agents.shadow');
  const activity = useTranslations('activity');
  const [report, setReport] = useState(initial);
  const [rows, setRows] = useState(initial.items);
  const [from, setFrom] = useState<string | undefined>(initial.from);
  const [to, setTo] = useState<string | undefined>(initial.to);
  const [problem, setProblem] = useState<PeriodProblem | undefined>();
  const reader = useQuery<ShadowReportDto>();
  const more = useQuery<ShadowReportDto>();
  // The answer for the filters last applied; an older answer is dropped.
  const wanted = useRef(0);

  const kindName = (kind: TriageProposalKind) => t(`kinds.${kind}`);
  const pipelineName = (key: string | null) =>
    key !== null && oneOf(SEGMENTS, key) ? activity(`values.segment.${key}`) : t('otherPipeline');

  function apply(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = periodProblem(from, to);
    setProblem(found);
    if (found !== undefined || from === undefined || to === undefined) return;
    const entityId = Number(formText(new FormData(e.currentTarget), 'company'));
    const ask = (wanted.current += 1);
    reader.load(
      () => shadowReport({ entityId, from, to, limit: SHADOW_PAGE_SIZE }),
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
        shadowReport({
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

  function proposed(r: ShadowProposalDto) {
    switch (r.kind) {
      case 'pipeline':
        return pipelineName(r.proposedPipelineKey);
      case 'score':
        return t('proposed.score', {
          change: signedPoints(r.proposedScoreChange ?? 0),
          score: String(r.proposedScore ?? ''),
        });
      case 'duplicate':
        return t('proposed.duplicate');
      case 'assignee':
        return r.proposedOwnerName ?? t('someone');
    }
  }

  function happened(r: ShadowProposalDto) {
    if (r.leadState === null) return t('happened.hidden');
    const score = String(r.score ?? '');
    switch (r.kind) {
      case 'pipeline':
        return t('happened.pipeline', { pipeline: pipelineName(r.pipelineKey) });
      case 'score':
        if (r.leadState === 'won') return t('happened.won', { score });
        if (r.leadState === 'lost') return t('happened.lost', { score });
        if (r.leadState === 'nurture') return t('happened.nurture', { score });
        return r.reachedQualified === true
          ? t('happened.qualified', { score })
          : t('happened.stillOpen', { score });
      case 'duplicate':
        return r.duplicateState === 'merged'
          ? t('happened.merged')
          : r.duplicateState === 'dismissed'
            ? t('happened.dismissed')
            : t('happened.openCard');
      case 'assignee':
        return r.ownerId === null
          ? t('happened.noOwner')
          : t('happened.owner', { person: r.ownerName ?? t('someone') });
    }
  }

  const columns: DataGridColumn<ShadowProposalDto>[] = [
    {
      id: 'when',
      header: t('columns.when'),
      numeric: true,
      cell: (r) => <DateTime value={r.createdAt} />,
    },
    { id: 'kind', header: t('columns.kind'), cell: (r) => kindName(r.kind), primary: true },
    {
      id: 'customer',
      header: t('columns.customer'),
      cell: (r) =>
        r.accountId !== null && r.customerName !== null ? (
          <Link href={customerHref(r.accountId, report.entityId)}>{r.customerName}</Link>
        ) : (
          <span className="text-text-muted">{t('unknownCustomer')}</span>
        ),
    },
    {
      id: 'proposed',
      header: t('columns.proposed'),
      cell: (r) => (
        <div className="flex flex-col gap-1">
          <span>{proposed(r)}</span>
          {r.note === null ? null : (
            <span className="text-text-muted text-xs">{t('note', { note: r.note })}</span>
          )}
        </div>
      ),
    },
    { id: 'happened', header: t('columns.happened'), cell: happened },
    {
      id: 'agreement',
      header: t('columns.agreement'),
      cell: (r) => (
        <StatusBadge tone={AGREEMENT_TONE[r.agreement]}>
          {t(`agreement.${r.agreement}`)}
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
        <Field id="shadow-company" label={t('filters.company')}>
          <Select name="company" defaultValue={String(initial.entityId)}>
            {Object.entries(companies).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="shadow-from"
          label={t('filters.from')}
          helper={t('filters.dateHelper')}
          error={problem === undefined ? undefined : t(`filters.${problem}`)}
        >
          <DateInput defaultValue={initial.from} onValueChange={setFrom} />
        </Field>
        <Field
          id="shadow-to"
          label={t('filters.to')}
          helper={t('filters.dateHelper')}
          actions={
            <Button type="submit" pending={reader.pending}>
              {t('filters.apply')}
            </Button>
          }
        >
          <DateInput
            defaultValue={initial.to}
            onValueChange={setTo}
            invalid={problem === undefined ? undefined : true}
          />
        </Field>
      </form>
      <FailureMessage failure={reader.failure ?? more.failure} />
      <section aria-labelledby="shadow-summary" className="flex flex-col gap-3">
        <h2 id="shadow-summary" className="text-h3">
          {t('summaryHeading')}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {report.summary.map((s) => (
            <KindSummary key={s.kind} summary={s} name={kindName(s.kind)} />
          ))}
        </ul>
      </section>
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
            : { label: t('loadMore'), pending: more.pending, onLoadMore: loadMore }
        }
      />
    </div>
  );
}

/** One kind's agreement, what still waits for people, and the runs the checks refused. */
function KindSummary({ summary, name }: { summary: ShadowKindSummaryDto; name: string }) {
  const t = useTranslations('agents.shadow');
  const agents = useTranslations('agents');
  const share = agreementShare(summary.agreed, summary.disagreed);
  const refused = summary.filtered.reduce((n, f) => n + f.runs, 0);
  return (
    <li className="border-border bg-surface flex flex-col gap-1 rounded-lg border p-4">
      <p className="font-medium">{name}</p>
      <p className="text-h3">{share === undefined ? t('noneDecided') : `${String(share)}%`}</p>
      <p className="text-text-muted text-sm">
        {t('agreed', {
          agreed: formatCount(summary.agreed),
          decided: formatCount(summary.agreed + summary.disagreed),
        })}
      </p>
      <p className="text-text-muted text-sm">{t('waiting', { count: summary.pending })}</p>
      <p className="text-text-muted text-sm">{t('refused', { count: refused })}</p>
      {summary.filtered.length === 0 ? null : (
        <ul className="text-text-muted text-xs">
          {summary.filtered.map((f) => (
            <li key={f.reason}>
              {t('refusedReason', {
                reason: agents(`filterReason.${f.reason}`),
                count: f.runs,
              })}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
