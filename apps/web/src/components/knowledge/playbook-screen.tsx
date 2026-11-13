'use client';

import type {
  PlaybookDirectiveDto,
  PlaybookDirectiveState,
  PlaybookDirectiveType,
  PlaybookPageDto,
  PlaybookReviewDto,
} from '@shakti/contracts';
import { Button, cn, EmptyState, Field, Select, StatusBadge } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  approveDirective,
  listPlaybook,
  loadPlaybookReview,
  recheckPlaybookReview,
} from '../../actions/playbook';
import { isTypingTarget } from '../../screens/calling';
import { PLAYBOOK_STATE_VALUES, PLAYBOOK_TYPE_VALUES } from '../../screens/contract-values';
import { approvable, playbookShortcut, stepDirective } from '../../screens/playbook';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import { PlaybookReview, STATE_TONE, type PlaybookDialog } from './playbook-review';

// The dialogs load when they are opened, so the screen ships only the list and the review.
const DirectiveFormDialog = dynamic(() =>
  import('./directive-form-dialog').then((m) => m.DirectiveFormDialog),
);
const RetireDirectiveDialog = dynamic(() =>
  import('./retire-directive-dialog').then((m) => m.RetireDirectiveDialog),
);
const ResolveConflictDialog = dynamic(() =>
  import('./resolve-conflict-dialog').then((m) => m.ResolveConflictDialog),
);
const DraftFromFileDialog = dynamic(() =>
  import('./draft-from-file-dialog').then((m) => m.DraftFromFileDialog),
);

export interface PlaybookCompany {
  id: number;
  name: string;
}

/** How often a rule waiting for its conflict check is read again. */
const RECHECK_MS = 3_000;

type CompanyFilter = number | 'group' | null;

interface Filters {
  state: PlaybookDirectiveState | null;
  type: PlaybookDirectiveType | null;
  company: CompanyFilter;
}

/**
 * `/knowledge/playbook` (docs/03-roadmap-appendix/phase2.md §5.4): the rules by status, kind and
 * company, and the review of the chosen one. J and K move through the list, A approves the rule
 * under review when it can be approved; none while a field or a dialog has the keyboard.
 */
export function PlaybookScreen({
  initial,
  initialReview,
  companies,
  allCompanies,
  canApprove,
  readsManagement,
}: {
  initial: PlaybookPageDto;
  initialReview: PlaybookReviewDto | undefined;
  companies: readonly PlaybookCompany[];
  /** All companies is chosen at the top, so a rule for every company may be drafted. */
  allCompanies: boolean;
  canApprove: boolean;
  /** The reader may write management rules. */
  readsManagement: boolean;
}) {
  const t = useTranslations('playbook');
  const common = useTranslations('common');
  const [filters, setFilters] = useState<Filters>({ state: null, type: null, company: null });
  const [list, setList] = useState(initial.directives);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [review, setReview] = useState(initialReview);
  const [selected, setSelected] = useState(initialReview?.directive.id);
  const [dialog, setDialog] = useState<PlaybookDialog | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const read = useQuery<PlaybookPageDto>();
  const reviewQuery = useQuery<PlaybookReviewDto>();
  const approve = useCommand(approveDirective);
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const firstCompany = companies[0]?.id ?? 0;
  const loadReview = reviewQuery.load;

  const open = useCallback(
    (id: string | undefined) => {
      setSelected(id);
      if (id === undefined) {
        setReview(undefined);
        return;
      }
      loadReview(
        () => loadPlaybookReview({ directiveId: id }),
        (found) => {
          setReview(found);
        },
      );
    },
    [loadReview],
  );

  // While the rule under review waits for its conflict check, it is read again until the check has
  // run, and its line in the list follows.
  const checkingId =
    review?.directive.state === 'draft' && review.directive.checkedAt === null
      ? review.directive.id
      : undefined;
  useEffect(() => {
    if (checkingId === undefined) return;
    const timer = setInterval(() => {
      loadReview(
        () => recheckPlaybookReview({ directiveId: checkingId }),
        (found) => {
          setReview((shown) => (shown?.directive.id === found.directive.id ? found : shown));
          setList((all) => all.map((d) => (d.id === found.directive.id ? found.directive : d)));
        },
      );
    }, RECHECK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [checkingId, loadReview]);

  function reload(next: Filters, keep?: string) {
    read.load(
      () => listPlaybook({ ...next }),
      (page) => {
        setList(page.directives);
        setCursor(page.nextCursor);
        const still = page.directives.find((d) => d.id === (keep ?? selected));
        open(still?.id ?? page.directives[0]?.id);
      },
    );
  }

  function changeFilter(change: Partial<Filters>) {
    const next = { ...filters, ...change };
    setFilters(next);
    setNotice(undefined);
    reload(next);
  }

  function loadMore() {
    if (cursor === null) return;
    read.load(
      () => listPlaybook({ ...filters, cursor }),
      (page) => {
        setList((all) => [...all, ...page.directives]);
        setCursor(page.nextCursor);
      },
    );
  }

  /** After a change: the notice, the list read again and the changed rule under review. */
  function changed(message: string, directiveId?: string) {
    setDialog(undefined);
    setNotice(message);
    reload(filters, directiveId);
  }

  const entityOf = useCallback(
    (d: Pick<PlaybookDirectiveDto, 'entityId'>) => d.entityId ?? firstCompany,
    [firstCompany],
  );

  function approveShown() {
    if (!canApprove || review === undefined || !approvable(review) || approve.pending) return;
    approve.run({ entityId: entityOf(review.directive), directiveId: review.directive.id }, (d) => {
      changed(t('notices.approved'), d.id);
    });
  }
  // The key handler is bound once a list or choice changes; it reaches the latest approve here.
  const approveRef = useRef(approveShown);
  useEffect(() => {
    approveRef.current = approveShown;
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      const shortcut = playbookShortcut(event);
      if (shortcut === undefined) return;
      event.preventDefault();
      if (shortcut === 'approve') approveRef.current();
      else open(stepDirective(list, selected, shortcut === 'next' ? 1 : -1));
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [list, selected, open]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <fieldset className="flex flex-wrap gap-3">
          <legend className="sr-only">{t('filters.label')}</legend>
          <Field id="playbook-state" label={t('filters.state')} className="w-40">
            <Select
              value={filters.state ?? ''}
              onChange={(e) => {
                changeFilter({ state: (e.target.value || null) as PlaybookDirectiveState | null });
              }}
            >
              <option value="">{t('filters.any')}</option>
              {PLAYBOOK_STATE_VALUES.map((s) => (
                <option key={s} value={s}>
                  {t(`state.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="playbook-type" label={t('filters.type')} className="w-48">
            <Select
              value={filters.type ?? ''}
              onChange={(e) => {
                changeFilter({ type: (e.target.value || null) as PlaybookDirectiveType | null });
              }}
            >
              <option value="">{t('filters.any')}</option>
              {PLAYBOOK_TYPE_VALUES.map((s) => (
                <option key={s} value={s}>
                  {t(`type.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="playbook-company" label={t('filters.company')} className="w-48">
            <Select
              value={filters.company === null ? '' : String(filters.company)}
              onChange={(e) => {
                const v = e.target.value;
                changeFilter({ company: v === '' ? null : v === 'group' ? 'group' : Number(v) });
              }}
            >
              <option value="">{t('filters.any')}</option>
              <option value="group">{t('filters.everyCompany')}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setDialog({ kind: 'draftFromFile' });
            }}
          >
            {t('draftFromFile')}
          </Button>
          <Button
            onClick={() => {
              setDialog({ kind: 'new' });
            }}
          >
            {t('new')}
          </Button>
        </div>
      </div>
      <p role="status" className="text-text-muted text-sm">
        {notice ?? ''}
      </p>
      <FailureMessage failure={read.failure ?? approve.failure} />
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <section aria-labelledby="playbook-list" className="flex min-w-0 flex-col gap-3">
          <h2 id="playbook-list" className="text-h3">
            {t('list.heading')}
          </h2>
          {list.length === 0 ? (
            <EmptyState message={t('list.empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    aria-current={d.id === selected ? 'true' : undefined}
                    onClick={() => {
                      open(d.id);
                    }}
                    className={cn(
                      'border-border bg-surface hover:bg-surface-2 flex w-full flex-col gap-1 rounded-md border p-3 text-left',
                      'focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none',
                      d.id === selected && 'border-primary',
                    )}
                  >
                    <span className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 font-medium break-words">{d.title}</span>
                      <StatusBadge tone={STATE_TONE[d.state]}>{t(`state.${d.state}`)}</StatusBadge>
                    </span>
                    <span className="text-text-muted text-sm">
                      {t(`type.${d.type}`)} · {t(`audience.${d.audience}`)} ·{' '}
                      {d.entityId === null
                        ? t('list.everyCompany')
                        : (names.get(d.entityId) ?? t('list.everyCompany'))}
                    </span>
                    {d.state !== 'draft' ? null : d.checkedAt === null ? (
                      <span className="text-text-subtle text-xs">{t('list.checking')}</span>
                    ) : d.conflictsWith.length > 0 ? (
                      <span className="text-danger text-xs">
                        {t('list.clashCount', { count: d.conflictsWith.length })}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {cursor === null ? null : (
            <Button
              variant="secondary"
              className="self-start"
              pending={read.pending}
              onClick={loadMore}
            >
              {common('loadMore')}
            </Button>
          )}
        </section>
        <PlaybookReview
          review={selected === undefined ? undefined : review}
          loading={reviewQuery.pending}
          failure={reviewQuery.failure}
          companyName={(id) => (id === null ? undefined : names.get(id))}
          canApprove={canApprove}
          approving={approve.pending}
          onApprove={approveShown}
          onDialog={setDialog}
        />
      </div>
      {dialog?.kind === 'new' || dialog?.kind === 'edit' ? (
        <DirectiveFormDialog
          directive={dialog.kind === 'edit' ? dialog.directive : undefined}
          companies={companies}
          allCompanies={allCompanies}
          readsManagement={readsManagement}
          onClose={() => {
            setDialog(undefined);
          }}
          onSaved={(d) => {
            changed(t('notices.saved'), d.id);
          }}
        />
      ) : null}
      {dialog?.kind === 'retire' ? (
        <RetireDirectiveDialog
          directive={dialog.directive}
          entityId={entityOf(dialog.directive)}
          onClose={() => {
            setDialog(undefined);
          }}
          onRetired={(d) => {
            changed(t('notices.retired'), d.id);
          }}
        />
      ) : null}
      {dialog?.kind === 'resolve' ? (
        <ResolveConflictDialog
          checkId={dialog.checkId}
          resolution={dialog.resolution}
          otherTitle={dialog.otherTitle}
          entityId={entityOf(dialog.directive)}
          onClose={() => {
            setDialog(undefined);
          }}
          onResolved={() => {
            changed(t('notices.settled'), dialog.directive.id);
          }}
        />
      ) : null}
      {dialog?.kind === 'draftFromFile' ? (
        <DraftFromFileDialog
          companies={companies}
          allCompanies={allCompanies}
          onClose={() => {
            setDialog(undefined);
          }}
          onDrafted={(drafts) => {
            changed(t('notices.drafted', { count: drafts.length }), drafts[0]?.id);
          }}
        />
      ) : null}
    </div>
  );
}
