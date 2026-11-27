'use client';

import type {
  ProjectFiltersDto,
  ProjectPageDto,
  ProjectRowDto,
  ProjectSegment,
  ProjectState,
} from '@shakti/contracts';
import {
  Button,
  DataGrid,
  EmptyState,
  Field,
  Select,
  StatusBadge,
  type DataGridColumn,
} from '@shakti/ui';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { listProjects } from '../../actions/projects';
import { PROJECT_SEGMENTS, PROJECT_STATES } from '../../screens/contract-values';
import { formatDateTime } from '../../screens/format';
import { PROJECT_STATE_TONE, projectHref } from '../../screens/projects';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useQuery } from '../screens/use-command';
import { useStepName } from './use-step-name';

const PAGE_SIZE = 50;

export interface ProjectFilters {
  state?: ProjectState | undefined;
  segment?: ProjectSegment | undefined;
  ownerId?: string | undefined;
  step?: string | undefined;
}

/** The filters as the list's query takes them, leaving out the empty ones. */
function filterInput(filters: ProjectFilters) {
  return {
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.segment ? { segment: filters.segment } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.step ? { step: filters.step } : {}),
  };
}

/**
 * `/projects` (docs/03-roadmap-appendix/phase4.md §6.1, `projects.read`): one company's projects
 * the caller reads, newest change first, by status, project manager, business line and current
 * step; each opens its project page. A Field Engineer sees the projects they are on.
 */
export function ProjectsScreen({
  initial,
  entityId,
  companies,
  choices,
  filters,
  ownOnly,
}: {
  initial: ProjectPageDto;
  entityId: number;
  /** The companies the caller may choose between, by id. */
  companies: Record<number, string>;
  choices: ProjectFiltersDto;
  filters: ProjectFilters;
  /** The caller reads only their own projects. */
  ownOnly: boolean;
}) {
  const t = useTranslations('projects');
  const common = useTranslations('common');
  const stepName = useStepName();
  const router = useRouter();
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const { load, pending, failure } = useQuery<ProjectPageDto>();

  function go(company: number, next: ProjectFilters) {
    const query = new URLSearchParams({ company: String(company) });
    for (const [key, value] of Object.entries(filterInput(next))) query.set(key, value);
    router.push(`/projects?${query.toString()}` as Route);
  }

  function apply(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const pick = <T extends string>(name: string, list: readonly T[]): T | undefined => {
      const value = formText(data, name);
      return (list as readonly string[]).includes(value) ? (value as T) : undefined;
    };
    go(Number(formText(data, 'company') || entityId), {
      state: pick('state', PROJECT_STATES),
      segment: pick('segment', PROJECT_SEGMENTS),
      ownerId: pick(
        'owner',
        choices.owners.map((o) => o.id),
      ),
      step: pick('step', choices.steps),
    });
  }

  const columns: DataGridColumn<ProjectRowDto>[] = [
    {
      id: 'project',
      header: t('columns.project'),
      primary: true,
      cell: (r) => (
        <Link
          href={projectHref(r.entityId, r.id)}
          className="text-accent-text font-medium tabular-nums hover:underline"
        >
          {r.projectNo}
        </Link>
      ),
    },
    {
      id: 'customer',
      header: t('columns.customer'),
      cell: (r) => (
        <span className="flex flex-col">
          <span>{r.customerName ?? t('noCustomer')}</span>
          {r.village === null ? null : <span className="text-text-muted text-xs">{r.village}</span>}
        </span>
      ),
    },
    { id: 'segment', header: t('columns.segment'), cell: (r) => t(`segments.${r.segment}`) },
    {
      id: 'step',
      header: t('columns.step'),
      cell: (r) =>
        r.stepKey === null ? t('noStep') : stepName({ key: r.stepKey, title: r.stepTitle }),
    },
    {
      id: 'owner',
      header: t('columns.owner'),
      cell: (r) => r.ownerName ?? t('page.ownerNone'),
    },
    {
      id: 'state',
      header: t('columns.state'),
      cell: (r) => (
        <StatusBadge tone={PROJECT_STATE_TONE[r.state]}>{t(`states.${r.state}`)}</StatusBadge>
      ),
    },
    {
      id: 'updated',
      header: t('columns.updated'),
      cell: (r) => <time dateTime={r.updatedAt}>{formatDateTime(r.updatedAt)}</time>,
    },
  ];

  const ids = Object.keys(companies).map(Number);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form onSubmit={apply} className="flex flex-col gap-3" aria-label={t('filters.label')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {ids.length > 1 ? (
            <Field id="projects-company" label={t('filters.company')}>
              <Select name="company" defaultValue={String(entityId)}>
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {companies[id]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field id="projects-state" label={t('filters.state')}>
            <Select name="state" defaultValue={filters.state ?? ''}>
              <option value="">{t('filters.anyState')}</option>
              {PROJECT_STATES.map((s) => (
                <option key={s} value={s}>
                  {t(`states.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="projects-segment" label={t('filters.segment')}>
            <Select name="segment" defaultValue={filters.segment ?? ''}>
              <option value="">{t('filters.anySegment')}</option>
              {PROJECT_SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {t(`segments.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="projects-owner" label={t('filters.owner')}>
            <Select name="owner" defaultValue={filters.ownerId ?? ''}>
              <option value="">{t('filters.anyOwner')}</option>
              {choices.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="projects-step" label={t('filters.step')}>
            <Select name="step" defaultValue={filters.step ?? ''}>
              <option value="">{t('filters.anyStep')}</option>
              {choices.steps.map((key) => (
                <option key={key} value={key}>
                  {stepName({ key, title: null })}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t('filters.apply')}</Button>
          <Button
            variant="secondary"
            onClick={() => {
              go(entityId, {});
            }}
          >
            {t('filters.clearFilters')}
          </Button>
        </div>
      </form>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={pending && rows.length === 0}
        empty={<EmptyState message={ownOnly ? t('emptyOwn') : t('empty')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : {
                label: common('loadMore'),
                onLoadMore: () => {
                  load(
                    () =>
                      listProjects({
                        entityId,
                        limit: PAGE_SIZE,
                        cursor: nextCursor,
                        ...filterInput(filters),
                      }),
                    (page) => {
                      setRows((all) => [...all, ...page.items]);
                      setNextCursor(page.nextCursor);
                    },
                  );
                },
                pending,
              }
        }
      />
    </div>
  );
}
