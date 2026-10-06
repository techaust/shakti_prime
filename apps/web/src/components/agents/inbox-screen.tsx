'use client';

import type { InboxDecisionDto, InboxItemDto, InboxPageDto } from '@shakti/contracts';
import {
  Button,
  EmptyState,
  StatusBadge,
  toast,
  useFocusTargets,
  type FocusTargets,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import {
  approveSuggestion,
  dismissSuggestion,
  listInbox,
  rejectSuggestion,
} from '../../actions/agents';
import {
  actionTypeName,
  agentFieldName,
  agentSummaryName,
  inboxKeyAction,
} from '../../screens/agents';
import { AGENT_ROLES, agentNameKey, TASK_KINDS } from '../../screens/contract-values';
import { customerHref, isOneOf } from '../../screens/customers';
import { DateTime } from '../date-time';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';

/** The edit dialog loads when first opened, so the list itself stays light. */
const EditSuggestionDialog = dynamic(() =>
  import('./edit-suggestion-dialog').then((m) => m.EditSuggestionDialog),
);

const PAGE_SIZE = 50;

/** A decision a card takes: Needs approval ones are approved or rejected, Suggest ones dismissed. */
type Decision = 'approve' | 'reject' | 'dismiss';

/** Typing in a field, or a key on a control that uses it, is never a shortcut. */
function typing(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** Whether the person acts on the suggestion themselves (Suggest) rather than deciding on it. */
const actYourself = (item: InboxItemDto): boolean => item.autonomy === 'suggest';

/** Whether a key's decision applies to the item: approve and reject, or dismiss, by autonomy. */
const fits = (item: InboxItemDto, decision: Decision): boolean =>
  actYourself(item) === (decision === 'dismiss');

/**
 * The Agent Inbox (docs/03-roadmap-appendix/phase1.md §7.1): the caller's open suggestions, newest first.
 * Keyboard first: J and K (or the arrow keys) move between suggestions; on one that needs approval
 * A approves, E opens Edit and R rejects; on one for the person to act on themselves (Suggest) O
 * opens the customer and D dismisses it. A decision runs as the caller, then the suggestion leaves
 * the list and the count in the top bar is read again. Each card keeps its own idempotency keys.
 */
export function InboxScreen({
  initial,
  companies,
}: {
  initial: InboxPageDto;
  companies: Record<number, string>;
}) {
  const t = useTranslations('agents');
  const common = useTranslations('common');
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<InboxItemDto | undefined>();
  const more = useQuery<InboxPageDto>();
  const cards = useFocusTargets<string>();
  const editButtons = useFocusTargets<string>();
  const decisions = useRef(new Map<string, (decision: Decision) => void>());
  const heading = useRef<HTMLHeadingElement>(null);
  const severalCompanies = Object.keys(companies).length > 1;

  function focusAt(index: number) {
    const item = items[index];
    if (item === undefined) return;
    setActive(index);
    cards.get(item.id)[0]?.focus();
  }

  /** The decided suggestion leaves the list; focus stays where the person was working. */
  function decided(item: InboxItemDto, decision: InboxDecisionDto) {
    const index = items.findIndex((i) => i.id === item.id);
    const rest = items.filter((i) => i.id !== item.id);
    setItems(rest);
    toast.success(t(`inbox.${decision.state}`));
    router.refresh();
    const next = rest[Math.min(index, rest.length - 1)];
    setActive(Math.max(0, Math.min(index, rest.length - 1)));
    requestAnimationFrame(() => {
      if (next === undefined) heading.current?.focus();
      else cards.get(next.id)[0]?.focus();
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (typing(event.target)) return;
    const action = inboxKeyAction(event);
    const item = items[active];
    if (action === undefined || item === undefined) return;
    event.preventDefault();
    if (action === 'next') focusAt(Math.min(active + 1, items.length - 1));
    else if (action === 'previous') focusAt(Math.max(active - 1, 0));
    else if (action === 'edit') {
      if (!actYourself(item) && item.fields.length > 0) setEditing(item);
    } else if (action === 'open') {
      if (item.accountId !== null) router.push(customerHref(item.accountId, item.entityId));
    } else if (fits(item, action)) decisions.current.get(item.id)?.(action);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 ref={heading} tabIndex={-1} className="sr-only">
        {t('inbox.caption')}
      </h2>
      <p className="text-text-muted text-sm">{t('inbox.keys')}</p>
      {items.length === 0 ? (
        <EmptyState message={t('inbox.empty')} />
      ) : (
        <ul aria-label={t('inbox.caption')} className="flex flex-col gap-3" onKeyDown={onKeyDown}>
          {items.map((item, index) => (
            <InboxCard
              key={item.id}
              item={item}
              focusable={index === active}
              company={severalCompanies ? companies[item.entityId] : undefined}
              cards={cards}
              editButtons={editButtons}
              decisions={decisions}
              onFocus={() => {
                setActive(index);
              }}
              onEdit={() => {
                setActive(index);
                setEditing(item);
              }}
              onDecided={(decision) => {
                decided(item, decision);
              }}
            />
          ))}
        </ul>
      )}
      {cursor === null ? null : (
        <Button
          variant="secondary"
          className="self-start"
          pending={more.pending}
          onClick={() => {
            more.load(
              () => listInbox({ limit: PAGE_SIZE, cursor }),
              (page) => {
                setItems((all) => [
                  ...all,
                  ...page.items.filter((i) => !all.some((a) => a.id === i.id)),
                ]);
                setCursor(page.nextCursor);
              },
            );
          }}
        >
          {t('inbox.loadMore')}
        </Button>
      )}
      <FailureMessage failure={more.failure} />
      {editing === undefined ? null : (
        <EditSuggestionDialog
          item={editing}
          closeLabel={common('close')}
          returnFocusTo={() => [
            editButtons.get(editing.id),
            cards.get(editing.id),
            heading.current,
          ]}
          onDecided={(decision) => {
            const item = editing;
            setEditing(undefined);
            decided(item, decision);
          }}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}

/**
 * One suggestion: what it would do, read-only (who the task is for, its kind) and the fields a
 * person may change, with its own decisions, so each card's idempotency keys are its own and a
 * failure on one card never reuses another's key.
 */
function InboxCard({
  item,
  focusable,
  company,
  cards,
  editButtons,
  decisions,
  onFocus,
  onEdit,
  onDecided,
}: {
  item: InboxItemDto;
  focusable: boolean;
  /** The company's name, when the inbox lists several companies. */
  company: string | undefined;
  cards: FocusTargets<string>;
  editButtons: FocusTargets<string>;
  decisions: RefObject<Map<string, (decision: Decision) => void>>;
  onFocus: () => void;
  onEdit: () => void;
  onDecided: (decision: InboxDecisionDto) => void;
}) {
  const t = useTranslations('agents');
  const customers = useTranslations('customers');
  const approve = useCommand(approveSuggestion);
  const reject = useCommand(rejectSuggestion);
  const dismiss = useCommand(dismissSuggestion);
  const pending = approve.pending || reject.pending || dismiss.pending;
  const commands = { approve, reject, dismiss };
  const action = actionTypeName(item.actionType);
  const titleId = `inbox-item-${item.id}`;
  const yourself = actYourself(item);

  function run(decision: Decision) {
    if (pending || !fits(item, decision)) return;
    commands[decision].run({ entityId: item.entityId, itemId: item.id }, onDecided);
  }

  // The list's keyboard reaches this card's decisions through the shared map, kept current.
  useEffect(() => {
    const map = decisions.current;
    map.set(item.id, run);
    return () => {
      map.delete(item.id);
    };
  });

  const agent = AGENT_ROLES.find((a) => a === item.agent);
  const agentName =
    agent === undefined ? t('admin.columns.agent') : t(`names.${agentNameKey(agent)}`);
  const openCustomer =
    item.accountId === null ? null : (
      <Link
        href={customerHref(item.accountId, item.entityId)}
        aria-keyshortcuts={yourself ? 'O' : undefined}
        className="text-accent-text underline-offset-4 hover:underline"
      >
        {t('inbox.openCustomer')}
      </Link>
    );

  return (
    <li
      ref={cards.ref(item.id)}
      tabIndex={focusable ? 0 : -1}
      aria-labelledby={titleId}
      onFocus={onFocus}
      className="border-border bg-surface focus-visible:outline-focus flex flex-col gap-3 rounded-lg border p-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-text-muted text-sm">{t('inbox.suggests', { agent: agentName })}</p>
          <h3 id={titleId} className="text-h3">
            {action === undefined ? t('outcome.proposed') : t(`actionTypes.${action}`)}
          </h3>
        </div>
        {item.autonomy === null ? null : (
          <StatusBadge tone="info">{t(`autonomy.${item.autonomy}`)}</StatusBadge>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          {item.subjectName === null
            ? t('inbox.forUnknown')
            : t('inbox.forCustomer', { customer: item.subjectName })}
        </span>
        {yourself ? null : openCustomer}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {item.summary.map((entry) => {
          const name = agentSummaryName(entry.name);
          let shown: string;
          if (entry.value === null) shown = t('inbox.noValue');
          else if (entry.kind === 'person') shown = entry.label ?? t('inbox.someone');
          else if (entry.name === 'kind' && isOneOf(TASK_KINDS, entry.value)) {
            shown = customers(`tasks.kind.${entry.value}`);
          } else shown = entry.value;
          return (
            <div key={entry.name} className="contents">
              <dt className="text-text-muted">
                {name === undefined ? entry.name : t(`inbox.summary.${name}`)}
              </dt>
              <dd>{shown}</dd>
            </div>
          );
        })}
        {item.fields.map((field) => {
          const name = agentFieldName(field.name);
          return (
            <div key={field.name} className="contents">
              <dt className="text-text-muted">
                {name === undefined ? field.name : t(`fields.${name}`)}
              </dt>
              <dd>
                {field.value === null ? (
                  t('inbox.noValue')
                ) : field.kind === 'date_time' ? (
                  <DateTime value={field.value} />
                ) : (
                  field.value
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-text-muted text-sm">
        {t('inbox.received')} <DateTime value={item.createdAt} />
        {company === undefined ? null : ` · ${t('inbox.companyLine', { company })}`}
      </p>
      {yourself ? <p className="text-text-muted text-sm">{t('inbox.actYourself')}</p> : null}
      <FailureMessage failure={approve.failure ?? reject.failure ?? dismiss.failure} />
      <div className="flex flex-wrap items-center gap-3">
        {yourself ? (
          <>
            {openCustomer}
            <Button
              size="sm"
              variant="secondary"
              aria-keyshortcuts="D"
              pending={dismiss.pending}
              onClick={() => {
                run('dismiss');
              }}
            >
              {t('inbox.dismiss')}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              aria-keyshortcuts="A"
              pending={approve.pending}
              onClick={() => {
                run('approve');
              }}
            >
              {t('inbox.approve')}
            </Button>
            {item.fields.length === 0 ? null : (
              <Button
                ref={editButtons.ref(item.id)}
                size="sm"
                variant="secondary"
                aria-keyshortcuts="E"
                disabled={pending}
                onClick={onEdit}
              >
                {t('inbox.edit')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-keyshortcuts="R"
              pending={reject.pending}
              onClick={() => {
                run('reject');
              }}
            >
              {t('inbox.reject')}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
