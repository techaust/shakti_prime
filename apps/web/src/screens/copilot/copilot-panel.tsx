'use client';

import type {
  CopilotFacts,
  CopilotPanelDto,
  CopilotPanelNoteDto,
  InboxItemDto,
} from '@shakti/contracts';
import { Button, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { approveSuggestion, dismissSuggestion, rejectSuggestion } from '../../actions/agents';
import { loadCopilotPanel, requestCopilotBrief } from '../../actions/copilot';
import { Key } from '../../components/calling/calling-parts';
import { momentValues } from '../../components/date-time';
import { FailureMessage } from '../../components/screens/failure';
import { useCommand, useQuery } from '../../components/screens/use-command';
import { actionTypeName } from '../agents';
import { isTypingTarget } from '../calling';
import { COPILOT_FACT_VALUES, TEMPLATE_OCCASION_VALUES } from '../contract-values';
import { isOneOf } from '../customers';
import { formatCount } from '../format';

// The Caller Co-pilot's panel in the Cold Caller and Lead Converter workspaces
// (docs/03-roadmap-appendix/phase2.md §7.3, PRD TEL-03): the brief before the call, the summary of
// the last recorded call with the facts heard and the outcome it would pick, and its suggestions
// for the lead, which `A` approves and `R` rejects. Nothing changes until a person acts: the
// outcome is only marked in the outcome buttons (`useCopilot().preselectId`), never logged.

/** How often the panel reads the lead's notes again while it is open, and for how long. */
const POLL_MS = 20_000;
const POLL_LIMIT = 30;
/** After a brief is asked for: how often the panel looks for it, and how many times. */
const BRIEF_POLL_MS = 4_000;
const BRIEF_POLL_LIMIT = 20;

export interface CopilotLead {
  entityId: number;
  opportunityId: string;
}

/** The panel's state for the open lead, shared with the outcome buttons it marks. */
export interface CopilotState {
  lead: CopilotLead | null;
  panel: CopilotPanelDto | undefined;
  /** The outcome to mark in the call log; never logged by the Co-pilot. */
  preselectId: string | null;
  load: ReturnType<typeof useQuery<CopilotPanelDto>>;
  reload: () => void;
  /** When the caller asked for a brief that has not arrived yet. */
  askedAt: number | undefined;
  setAskedAt: (at: number | undefined) => void;
}

/** The Co-pilot's panel of `lead`, read when the lead opens and every 20 seconds after. */
export function useCopilot(lead: CopilotLead | null): CopilotState {
  const load = useQuery<CopilotPanelDto>();
  const [panel, setPanel] = useState<CopilotPanelDto>();
  // When the caller asked for a brief, and on which lead.
  const [asked, setAsked] = useState<{ opportunityId: string; at: number }>();
  const entityId = lead?.entityId;
  const opportunityId = lead?.opportunityId;
  const { load: read } = load;

  const reload = useCallback(() => {
    if (entityId === undefined || opportunityId === undefined) return;
    read(
      () => loadCopilotPanel({ entityId, opportunityId }),
      (data) => {
        setPanel(data);
      },
    );
  }, [read, entityId, opportunityId]);

  useEffect(() => {
    if (opportunityId === undefined) return undefined;
    reload();
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > POLL_LIMIT) window.clearInterval(timer);
      else if (document.visibilityState === 'visible') reload();
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [opportunityId, reload]);

  // Another lead's panel is never shown while this one's is read.
  const current = panel?.opportunityId === opportunityId ? panel : undefined;
  // A brief asked for is looked for more often until it arrives.
  const brief = current?.brief ?? null;
  const briefAt = brief === null ? 0 : Date.parse(brief.createdAt);
  const askedAt = asked?.opportunityId === opportunityId ? asked.at : undefined;
  const waiting = askedAt !== undefined && briefAt < askedAt;
  useEffect(() => {
    if (!waiting) return undefined;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > BRIEF_POLL_LIMIT) {
        window.clearInterval(timer);
        setAsked(undefined);
      } else reload();
    }, BRIEF_POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [waiting, reload]);

  const setAskedAt = useCallback(
    (at: number | undefined) => {
      setAsked(at === undefined || opportunityId === undefined ? undefined : { opportunityId, at });
    },
    [opportunityId],
  );
  return {
    lead,
    panel: current,
    preselectId: current?.preselectDispositionId ?? null,
    load,
    reload,
    askedAt: waiting ? askedAt : undefined,
    setAskedAt,
  };
}

/** The facts a note heard or a suggestion records, as a short list. */
function Facts({ facts }: { facts: CopilotFacts }) {
  const q = useTranslations('qualification.facts');
  const shown = COPILOT_FACT_VALUES.filter((f) => facts[f] !== undefined);
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {shown.map((fact) => (
        <div key={fact} className="contents">
          <dt className="text-text-muted">{q(fact)}</dt>
          <dd className="tabular-nums">{formatCount(facts[fact] ?? 0)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A brief or a summary, with when it was written. */
function Note({
  heading,
  note,
  empty,
}: {
  heading: string;
  note: CopilotPanelNoteDto | null;
  empty: string;
}) {
  const t = useTranslations('agents.copilot');
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="font-medium">{heading}</h3>
      {note === null ? (
        <p className="text-text-muted text-sm">{empty}</p>
      ) : (
        <>
          <p className="break-words whitespace-pre-line">{note.body}</p>
          <p className="text-text-muted text-xs">
            {t.rich('written', momentValues(note.createdAt))}
          </p>
          {note.kind === 'call_summary' ? (
            <>
              <Facts facts={note.fields} />
              {note.suggestedOutcomeLabel === null ? null : (
                <p className="text-sm">
                  {t('suggestedOutcome', { outcome: note.suggestedOutcomeLabel })}
                </p>
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/** What one suggestion would do, in words. */
function SuggestionBody({ item, facts }: { item: InboxItemDto; facts: CopilotFacts | undefined }) {
  const t = useTranslations('agents');
  const due = item.fields.find((f) => f.name === 'dueAt')?.value ?? null;
  const title = item.fields.find((f) => f.name === 'title')?.value ?? null;
  const template = item.summary.find((s) => s.name === 'templateName');
  const occasion = item.summary.find((s) => s.name === 'occasion')?.value ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      {facts === undefined ? null : <Facts facts={facts} />}
      {due === null ? null : <p>{t.rich('copilot.dueAt', momentValues(due))}</p>}
      {title === null ? null : <p className="break-words">{title}</p>}
      {template === undefined ? null : (
        <p className="break-words">{template.label ?? template.value ?? ''}</p>
      )}
      {occasion !== null && isOneOf(TEMPLATE_OCCASION_VALUES, occasion) ? (
        <p className="text-text-muted">{t(`inbox.occasion.${occasion}`)}</p>
      ) : null}
    </div>
  );
}

/** Whether a dialog is open over the workspace, which keeps its keys to itself. */
function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * The Co-pilot panel of the open lead: its brief (asked for again at most once an hour), the
 * summary of its last recorded call, and its suggestions with Approve (`A`) and Reject (`R`) for
 * the first one that needs approval, and Dismiss for one to act on yourself.
 */
export function CopilotPanel({ copilot }: { copilot: CopilotState }) {
  const t = useTranslations('agents.copilot');
  const inbox = useTranslations('agents.inbox');
  const types = useTranslations('agents.actionTypes');
  const id = useId();
  const { lead, panel, reload, setAskedAt } = copilot;
  const ask = useCommand(requestCopilotBrief, lead?.opportunityId);
  const approve = useCommand(approveSuggestion);
  const reject = useCommand(rejectSuggestion);
  const dismiss = useCommand(dismissSuggestion);
  const busy = approve.pending || reject.pending || dismiss.pending;

  const decided = useCallback(
    (message: string) => () => {
      toast.success(message);
      reload();
    },
    [reload],
  );
  const first = panel?.suggestions.find((s) => s.autonomy === 'needs_approval');
  const decide = useCallback(
    (kind: 'approve' | 'reject', item: InboxItemDto | undefined) => {
      if (item === undefined || busy) return;
      const ref = { entityId: item.entityId, itemId: item.id };
      if (kind === 'approve') approve.run(ref, decided(inbox('approved')));
      else reject.run(ref, decided(inbox('rejected')));
    },
    [approve, reject, busy, decided, inbox],
  );

  // `A` approves and `R` rejects the first suggestion that needs approval.
  useEffect(() => {
    if (first === undefined) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || dialogOpen()) return;
      const key = e.key.toLowerCase();
      if (key !== 'a' && key !== 'r') return;
      e.preventDefault();
      decide(key === 'a' ? 'approve' : 'reject', first);
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [first, decide]);

  if (lead === null) return null;
  const canAsk = panel?.nextBriefAt === null && copilot.askedAt === undefined;
  return (
    <section
      aria-labelledby={id}
      aria-busy={copilot.load.pending}
      className="border-border bg-surface flex min-w-0 flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-h3">
          {t('title')}
        </h2>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canAsk}
          pending={ask.pending}
          onClick={() => {
            ask.run(lead, () => {
              setAskedAt(Date.now());
              toast.success(t('briefAsked'));
            });
          }}
        >
          {t('askBrief')}
        </Button>
      </div>
      <p className="text-text-muted text-sm">{t('intro')}</p>
      <FailureMessage
        failure={
          copilot.load.failure ??
          ask.failure ??
          approve.failure ??
          reject.failure ??
          dismiss.failure
        }
      />
      {panel === undefined ? null : (
        <>
          <Note
            heading={t('brief')}
            note={panel.brief}
            empty={copilot.askedAt === undefined ? t('noBrief') : t('briefComing')}
          />
          {panel.nextBriefAt === null ? null : (
            <p className="text-text-muted text-xs">
              {t.rich('nextBrief', momentValues(panel.nextBriefAt))}
            </p>
          )}
          <Note heading={t('summary')} note={panel.summary} empty={t('noSummary')} />
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="font-medium">{t('suggestions')}</h3>
            {panel.suggestions.length === 0 ? (
              <p className="text-text-muted text-sm">{t('noSuggestions')}</p>
            ) : (
              <>
                {first === undefined ? null : (
                  <p className="text-text-muted text-xs">{t('keys')}</p>
                )}
                <ul className="flex flex-col gap-2">
                  {panel.suggestions.map((item) => {
                    const name = actionTypeName(item.actionType);
                    const isFirst = item.id === first?.id;
                    return (
                      <li
                        key={item.id}
                        className="border-border flex min-w-0 flex-col gap-2 rounded-md border p-3"
                      >
                        <p className="font-medium">
                          {name === undefined ? t('suggestion') : types(name)}
                        </p>
                        <SuggestionBody item={item} facts={panel.suggestedFacts[item.id]} />
                        <div className="flex flex-wrap gap-2">
                          {item.autonomy === 'needs_approval' ? (
                            <>
                              <Button
                                size="sm"
                                pending={approve.pending && isFirst}
                                disabled={busy}
                                aria-keyshortcuts={isFirst ? 'A' : undefined}
                                onClick={() => {
                                  decide('approve', item);
                                }}
                              >
                                {inbox('approve')} {isFirst ? <Key>{t('approveKey')}</Key> : null}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                aria-keyshortcuts={isFirst ? 'R' : undefined}
                                onClick={() => {
                                  decide('reject', item);
                                }}
                              >
                                {inbox('reject')} {isFirst ? <Key>{t('rejectKey')}</Key> : null}
                              </Button>
                            </>
                          ) : (
                            <>
                              <p className="text-text-muted w-full text-sm">
                                {inbox('actYourself')}
                              </p>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => {
                                  dismiss.run(
                                    { entityId: item.entityId, itemId: item.id },
                                    decided(inbox('dismissed')),
                                  );
                                }}
                              >
                                {inbox('dismiss')}
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
