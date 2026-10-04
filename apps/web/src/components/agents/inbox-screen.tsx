'use client';

import type { InboxDecisionDto, InboxItemDto, InboxPageDto } from '@shakti/contracts';
import { Button, EmptyState, StatusBadge, toast, useFocusTargets } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type KeyboardEvent } from 'react';
import { approveSuggestion, listInbox, rejectSuggestion } from '../../actions/agents';
import { actionTypeName, agentFieldName, inboxKeyAction } from '../../screens/agents';
import { AGENT_ROLES, agentNameKey } from '../../screens/contract-values';
import { customerHref } from '../../screens/customers';
import { formatDateTime } from '../../screens/format';
import { DateTime } from '../date-time';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';

/** The edit dialog loads when first opened, so the list itself stays light. */
const EditSuggestionDialog = dynamic(() =>
  import('./edit-suggestion-dialog').then((m) => m.EditSuggestionDialog),
);

const PAGE_SIZE = 50;

/** Typing in a field, or a key on a control that uses it, is never a shortcut. */
function typing(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * The Agent Inbox (docs/design/phase1.md §7.1): the caller's open suggestions, newest first.
 * Keyboard first: J and K (or the arrow keys) move between suggestions, A approves, E opens Edit,
 * R rejects. A decision runs as the caller, then the suggestion leaves the list and the count in
 * the top bar is read again.
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
  const approve = useCommand(approveSuggestion);
  const reject = useCommand(rejectSuggestion);
  const more = useQuery<InboxPageDto>();
  const cards = useFocusTargets<string>();
  const editButtons = useFocusTargets<string>();
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = approve.pending || reject.pending;
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
    toast.success(t(decision.state === 'approved' ? 'inbox.approved' : 'inbox.rejected'));
    router.refresh();
    const next = rest[Math.min(index, rest.length - 1)];
    setActive(Math.max(0, Math.min(index, rest.length - 1)));
    requestAnimationFrame(() => {
      if (next === undefined) heading.current?.focus();
      else cards.get(next.id)[0]?.focus();
    });
  }

  function run(kind: 'approve' | 'reject', item: InboxItemDto) {
    if (pending) return;
    const command = kind === 'approve' ? approve : reject;
    command.run({ entityId: item.entityId, itemId: item.id }, (decision) => {
      decided(item, decision);
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
    else if (action === 'edit') setEditing(item);
    else run(action, item);
  }

  const agentName = (item: InboxItemDto) => {
    const agent = AGENT_ROLES.find((a) => a === item.agent);
    return agent === undefined ? t('admin.columns.agent') : t(`names.${agentNameKey(agent)}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 ref={heading} tabIndex={-1} className="sr-only">
        {t('inbox.caption')}
      </h2>
      <p className="text-text-muted text-sm">{t('inbox.keys')}</p>
      <FailureMessage failure={approve.failure ?? reject.failure} />
      {items.length === 0 ? (
        <EmptyState message={t('inbox.empty')} />
      ) : (
        <ul aria-label={t('inbox.caption')} className="flex flex-col gap-3" onKeyDown={onKeyDown}>
          {items.map((item, index) => {
            const action = actionTypeName(item.actionType);
            const titleId = `inbox-item-${item.id}`;
            return (
              <li
                key={item.id}
                ref={cards.ref(item.id)}
                tabIndex={index === active ? 0 : -1}
                aria-labelledby={titleId}
                onFocus={() => {
                  setActive(index);
                }}
                className="border-border bg-surface focus-visible:outline-focus flex flex-col gap-3 rounded-lg border p-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-text-muted text-sm">
                      {t('inbox.suggests', { agent: agentName(item) })}
                    </p>
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
                  {item.accountId === null ? null : (
                    <Link
                      href={customerHref(item.accountId, item.entityId)}
                      className="text-accent-text underline-offset-4 hover:underline"
                    >
                      {t('inbox.openCustomer')}
                    </Link>
                  )}
                </p>
                {item.fields.length === 0 ? null : (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    {item.fields.map((field) => {
                      const name = agentFieldName(field.name);
                      return (
                        <div key={field.name} className="contents">
                          <dt className="text-text-muted">
                            {name === undefined ? field.name : t(`fields.${name}`)}
                          </dt>
                          <dd>
                            {field.value === null
                              ? t('inbox.noValue')
                              : field.kind === 'date_time'
                                ? formatDateTime(field.value)
                                : field.value}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
                <p className="text-text-muted text-sm">
                  {t.rich('inbox.received', {
                    at: () => <DateTime value={item.createdAt} />,
                  })}
                  {severalCompanies && companies[item.entityId] !== undefined
                    ? ` · ${t('inbox.companyLine', { company: companies[item.entityId] ?? '' })}`
                    : null}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    aria-keyshortcuts="A"
                    pending={approve.pending && active === index}
                    onClick={() => {
                      setActive(index);
                      run('approve', item);
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
                      onClick={() => {
                        setActive(index);
                        setEditing(item);
                      }}
                    >
                      {t('inbox.edit')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-keyshortcuts="R"
                    pending={reject.pending && active === index}
                    onClick={() => {
                      setActive(index);
                      run('reject', item);
                    }}
                  >
                    {t('inbox.reject')}
                  </Button>
                </div>
              </li>
            );
          })}
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
