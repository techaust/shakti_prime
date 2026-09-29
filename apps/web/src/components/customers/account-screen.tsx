'use client';

import type {
  Account360Dto,
  ActivityDto,
  CustomerLeadDto,
  CustomerTaskDto,
  TimelinePageDto,
} from '@shakti/contracts';
import { Button, EmptyState, StatusBadge, toast, type StatusTone } from '@shakti/ui';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  cancelTask,
  completeTask,
  listTimeline,
  loadAccount360,
  untagLead,
} from '../../actions/crm';
import {
  ACCOUNT_TYPES,
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  OPPORTUNITY_STATES,
  TASK_KINDS,
} from '../../screens/contract-values';
import { customerHref, isOneOf as oneOf } from '../../screens/customers';
import { formatDateTime, formatPhone } from '../../screens/format';
import { Page } from '../shell/page';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import type { CustomerDialogKind } from './customer-dialogs';

// The dialogs load on first use, so the page ships only what it shows.
const CustomerDialog = dynamic(() => import('./customer-dialogs').then((m) => m.CustomerDialog));

const STATE_TONE: Record<CustomerLeadDto['state'], StatusTone> = {
  open: 'accent',
  nurture: 'info',
  won: 'success',
  lost: 'neutral',
};

/** One titled part of Account 360, with its actions on the right. */
function Section({
  id,
  title,
  actions,
  children,
}: {
  id: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-h3">
          {title}
        </h2>
        {actions === undefined ? null : <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Account 360 (CRM-07): the customer as one company deals with them. The header, contacts with
 * their numbers in full, sites and consents on one side; leads with their tags, open tasks and the
 * history on the other; one column on a phone. Every change goes through its command, then the
 * page reads the customer again.
 */
export function AccountScreen({
  initial,
  companies,
}: {
  initial: Account360Dto;
  companies: Record<number, string>;
}) {
  const t = useTranslations('customers');
  const leadsT = useTranslations('leads');
  const [view, setView] = useState(initial);
  const [dialog, setDialog] = useState<CustomerDialogKind | undefined>();
  const refresh = useQuery<Account360Dto>();

  function reload() {
    refresh.load(
      () => loadAccount360({ accountId: view.account.id, entityId: view.entityId }),
      setView,
    );
  }

  function done() {
    setDialog(undefined);
    reload();
  }

  const typeName = oneOf(ACCOUNT_TYPES, view.account.type)
    ? leadsT(`accountType.${view.account.type}`)
    : view.account.type;

  return (
    <Page
      width="detail"
      title={view.account.name}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">{typeName}</StatusBadge>
          <span>
            {view.ownerName === null
              ? t('account.nobody')
              : t('account.lookedAfterBy', { name: view.ownerName })}
          </span>
        </span>
      }
      actions={
        <>
          <Button asChild variant="secondary">
            <Link href="/customers">{t('account.back')}</Link>
          </Button>
          {view.canEdit ? (
            <Button
              onClick={() => {
                setDialog({ kind: 'account' });
              }}
            >
              {t('account.edit')}
            </Button>
          ) : null}
        </>
      }
    >
      <FailureMessage failure={refresh.failure} />
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Detail label={t('account.company')}>{companies[view.entityId] ?? ''}</Detail>
        <Detail label={t('account.gstin')}>{view.account.gstin ?? t('notRecorded')}</Detail>
        <Detail label={t('account.billingState')}>
          {view.account.billingStateCode ?? t('notRecorded')}
        </Detail>
        {view.otherEntityIds.length === 0 ? null : (
          <Detail label={t('account.alsoWith')}>
            <span className="flex flex-wrap gap-x-3">
              {view.otherEntityIds.map((e) => (
                <Link
                  key={e}
                  href={customerHref(view.account.id, e)}
                  className="text-accent-text hover:underline"
                >
                  {companies[e] ?? String(e)}
                </Link>
              ))}
            </span>
          </Detail>
        )}
      </dl>
      {view.canEdit ? null : <p className="text-text-muted text-sm">{t('account.readOnly')}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Contacts
            view={view}
            onEdit={(contactId) => {
              setDialog({ kind: 'contact', contactId });
            }}
          />
          <Sites
            view={view}
            onAdd={() => {
              setDialog({ kind: 'site' });
            }}
            onEdit={(siteId) => {
              setDialog({ kind: 'site', siteId });
            }}
          />
          <Consents
            view={view}
            onRecord={() => {
              setDialog({ kind: 'consent' });
            }}
            onWithdraw={(consentId) => {
              setDialog({ kind: 'withdraw', consentId });
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Leads
            view={view}
            onAddTag={(opportunityId) => {
              setDialog({ kind: 'tag', opportunityId });
            }}
            onChanged={reload}
          />
          <Tasks
            view={view}
            onAdd={() => {
              setDialog({ kind: 'task' });
            }}
            onReschedule={(task) => {
              setDialog({ kind: 'reschedule', task });
            }}
            onChanged={reload}
          />
          <Timeline
            key={view.timeline.items[0]?.id ?? 'empty'}
            view={view}
            onAddNote={() => {
              setDialog({ kind: 'note' });
            }}
          />
        </div>
      </div>
      {dialog === undefined ? null : (
        <CustomerDialog
          dialog={dialog}
          view={view}
          onDone={done}
          onCancel={() => {
            setDialog(undefined);
          }}
        />
      )}
    </Page>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-text-muted text-sm">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function Contacts({ view, onEdit }: { view: Account360Dto; onEdit: (id: string) => void }) {
  const t = useTranslations('customers');
  const leadsT = useTranslations('leads');
  return (
    <Section id="account-contacts" title={t('contacts.sectionTitle')}>
      <ul className="flex flex-col gap-4">
        {view.contacts.map((c) => (
          <li key={c.id} className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium break-words">{c.name}</span>
              {view.canEdit ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onEdit(c.id);
                  }}
                >
                  {t('contacts.edit')}
                </Button>
              ) : null}
            </div>
            <span className="text-text-muted text-sm">
              {t(`contacts.role.${c.role}`)} · {leadsT(`language.${c.preferredLanguage}`)} ·{' '}
              {c.email ?? t('contacts.noEmail')}
            </span>
            <ul className="flex flex-col gap-1">
              {c.phones.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <a
                    href={`tel:${p.e164}`}
                    className="text-accent-text tabular-nums hover:underline"
                  >
                    {formatPhone(p.e164)}
                  </a>
                  {p.isPrimary ? (
                    <StatusBadge tone="accent">{t('contacts.main')}</StatusBadge>
                  ) : null}
                  {p.isWhatsapp ? (
                    <StatusBadge tone="neutral">{t('contacts.whatsapp')}</StatusBadge>
                  ) : null}
                  {p.isDnd ? <StatusBadge tone="warning">{t('contacts.dnd')}</StatusBadge> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Sites({
  view,
  onAdd,
  onEdit,
}: {
  view: Account360Dto;
  onAdd: () => void;
  onEdit: (id: string) => void;
}) {
  const t = useTranslations('customers');
  const leadsT = useTranslations('leads');
  return (
    <Section
      id="account-sites"
      title={t('sites.sectionTitle')}
      actions={
        view.canEdit ? (
          <Button size="sm" variant="secondary" onClick={onAdd}>
            {t('sites.add')}
          </Button>
        ) : undefined
      }
    >
      {view.sites.length === 0 ? (
        <p className="text-text-muted">{t('sites.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {view.sites.map((s) => (
            <li key={s.id} className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{leadsT(`siteType.${s.type}`)}</span>
                {view.canEdit ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      onEdit(s.id);
                    }}
                  >
                    {t('sites.edit')}
                  </Button>
                ) : null}
              </div>
              <span className="text-text-muted text-sm break-words">
                {[s.address, s.village, s.tehsil, s.district, s.pin]
                  .filter((part) => part !== null && part !== '')
                  .join(', ') || t('notRecorded')}
              </span>
              {s.lat === null || s.lng === null ? null : (
                <span className="text-text-subtle text-xs tabular-nums">
                  {t('sites.location', { lat: s.lat.toFixed(5), lng: s.lng.toFixed(5) })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Consents({
  view,
  onRecord,
  onWithdraw,
}: {
  view: Account360Dto;
  onRecord: () => void;
  onWithdraw: (id: string) => void;
}) {
  const t = useTranslations('customers');
  const names = new Map(view.contacts.map((c) => [c.id, c.name]));
  return (
    <Section
      id="account-consents"
      title={t('consent.sectionTitle')}
      actions={
        view.canEdit ? (
          <Button size="sm" variant="secondary" onClick={onRecord}>
            {t('consent.record')}
          </Button>
        ) : undefined
      }
    >
      {view.consents.length === 0 ? (
        <p className="text-text-muted">{t('consent.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {view.consents.map((c) => (
            <li key={c.id} className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {oneOf(CONSENT_CHANNELS, c.channel) ? t(`consent.channel.${c.channel}`) : ''}
                  {' · '}
                  {oneOf(CONSENT_PURPOSES, c.purpose) ? t(`consent.purpose.${c.purpose}`) : ''}
                </span>
                {c.withdrawnAt === null ? (
                  <StatusBadge tone="success">{t('consent.active')}</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">{t('consent.withdrawnBadge')}</StatusBadge>
                )}
              </div>
              <span className="text-text-muted text-sm">
                {names.get(c.contactId) ?? ''} · {t(`consent.source.${c.source}`)}
              </span>
              <span className="text-text-muted text-sm">
                {t('consent.given', {
                  when: formatDateTime(c.givenAt),
                  version: c.textVersion,
                })}
              </span>
              {c.withdrawnAt === null ? (
                view.canEdit ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="self-start"
                    onClick={() => {
                      onWithdraw(c.id);
                    }}
                  >
                    {t('consent.withdraw')}
                  </Button>
                ) : null
              ) : (
                <span className="text-text-muted text-sm">
                  {t('consent.withdrawnOn', { when: formatDateTime(c.withdrawnAt) })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Leads({
  view,
  onAddTag,
  onChanged,
}: {
  view: Account360Dto;
  onAddTag: (opportunityId: string) => void;
  onChanged: () => void;
}) {
  const t = useTranslations('customers');
  const leadsT = useTranslations('leads');
  const untag = useCommand(untagLead);
  return (
    <Section id="account-leads" title={t('leads.sectionTitle')}>
      <FailureMessage failure={untag.failure} />
      {view.leads.length === 0 ? (
        <p className="text-text-muted">{t('leads.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {view.leads.map((l) => (
            <li
              key={l.id}
              className="border-border flex min-w-0 flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium break-words">
                  {l.pipelineName} · {l.stageName}
                </span>
                <StatusBadge tone={STATE_TONE[l.state]}>
                  {oneOf(OPPORTUNITY_STATES, l.state) ? leadsT(`state.${l.state}`) : l.state}
                </StatusBadge>
              </div>
              <span className="text-text-muted text-sm">
                {l.ownerName === null
                  ? t('leads.noOwner')
                  : t('leads.owner', { name: l.ownerName })}{' '}
                · {formatDateTime(l.updatedAt)}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {l.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="border-border bg-surface-2 inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-xs"
                  >
                    {tag.name}
                    {view.canWorkLeads ? (
                      <button
                        type="button"
                        className="text-text-muted hover:text-text inline-flex size-5 items-center justify-center rounded-full"
                        aria-label={t('leads.removeTag', { name: tag.name })}
                        disabled={untag.pending}
                        onClick={() => {
                          untag.run(
                            { entityId: view.entityId, opportunityId: l.id, tagId: tag.id },
                            onChanged,
                          );
                        }}
                      >
                        <X aria-hidden className="size-3" />
                      </button>
                    ) : null}
                  </span>
                ))}
                {view.canWorkLeads ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onAddTag(l.id);
                    }}
                  >
                    {t('leads.addTag')}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Tasks({
  view,
  onAdd,
  onReschedule,
  onChanged,
}: {
  view: Account360Dto;
  onAdd: () => void;
  onReschedule: (task: CustomerTaskDto) => void;
  onChanged: () => void;
}) {
  const t = useTranslations('customers');
  const complete = useCommand(completeTask);
  const cancel = useCommand(cancelTask);
  // The task whose button was pressed, so only its button shows the wait.
  const [busy, setBusy] = useState<string | undefined>();
  const canAdd = view.canWorkLeads && view.leads.length > 0;
  return (
    <Section
      id="account-tasks"
      title={t('tasks.sectionTitle')}
      actions={
        canAdd ? (
          <Button size="sm" variant="secondary" onClick={onAdd}>
            {t('tasks.add')}
          </Button>
        ) : undefined
      }
    >
      <FailureMessage failure={complete.failure ?? cancel.failure} />
      {view.tasks.length === 0 ? (
        <EmptyState message={t('tasks.empty')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {view.tasks.map((task) => (
            <li key={task.id} className="flex min-w-0 flex-col gap-1">
              <span className="font-medium break-words">
                {oneOf(TASK_KINDS, task.kind) ? t(`tasks.kind.${task.kind}`) : task.kind}
                {task.title === null ? null : ` · ${task.title}`}
              </span>
              <span className="text-text-muted text-sm">
                {t('tasks.due', { when: formatDateTime(task.dueAt) })}
                {task.assigneeName === null
                  ? null
                  : ` · ${t('tasks.forPerson', { name: task.assigneeName })}`}
              </span>
              {view.canWorkLeads ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    pending={complete.pending && busy === task.id}
                    onClick={() => {
                      setBusy(task.id);
                      complete.run({ entityId: view.entityId, taskId: task.id }, () => {
                        toast.success(t('tasks.doneToast'));
                        onChanged();
                      });
                    }}
                  >
                    {t('tasks.markDone')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      onReschedule(task);
                    }}
                  >
                    {t('tasks.reschedule')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    pending={cancel.pending && busy === task.id}
                    onClick={() => {
                      setBusy(task.id);
                      cancel.run({ entityId: view.entityId, taskId: task.id }, () => {
                        toast.success(t('tasks.cancelledToast'));
                        onChanged();
                      });
                    }}
                  >
                    {t('tasks.cancel')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** A timeline row in words: what happened, a detail when it has one, who and when. */
function TimelineRow({ item }: { item: ActivityDto }) {
  const t = useTranslations('customers');
  const tagName = item.payload.tagName;
  const kind = item.payload.kind;
  const detail =
    item.type === 'note'
      ? item.body
      : typeof tagName === 'string'
        ? t('timeline.tagDetail', { name: tagName })
        : typeof kind === 'string' && oneOf(TASK_KINDS, kind)
          ? t(`tasks.kind.${kind}`)
          : null;
  return (
    <li className="border-border flex min-w-0 flex-col gap-0.5 border-l-2 pl-3">
      <span className="font-medium">{t(`timeline.type.${item.type}`)}</span>
      {detail === null ? null : <span className="break-words whitespace-pre-line">{detail}</span>}
      <span className="text-text-muted text-xs">
        {t('timeline.by', {
          name: item.actorName ?? t('timeline.someone'),
          when: formatDateTime(item.createdAt),
        })}
      </span>
    </li>
  );
}

function Timeline({ view, onAddNote }: { view: Account360Dto; onAddNote: () => void }) {
  const t = useTranslations('customers');
  const common = useTranslations('common');
  const [items, setItems] = useState(view.timeline.items);
  const [cursor, setCursor] = useState(view.timeline.nextCursor);
  const more = useQuery<TimelinePageDto>();

  function loadMore() {
    if (cursor === null) return;
    more.load(
      () => listTimeline({ entityId: view.entityId, accountId: view.account.id, cursor }),
      (page) => {
        setItems((all) => [...all, ...page.items]);
        setCursor(page.nextCursor);
      },
    );
  }

  return (
    <Section
      id="account-timeline"
      title={t('timeline.sectionTitle')}
      actions={
        view.canWorkLeads ? (
          <Button size="sm" variant="secondary" onClick={onAddNote}>
            {t('timeline.addNote')}
          </Button>
        ) : undefined
      }
    >
      <FailureMessage failure={more.failure} />
      {items.length === 0 ? (
        <p className="text-text-muted">{t('timeline.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))}
        </ol>
      )}
      {cursor === null ? null : (
        <Button
          variant="secondary"
          className="self-start"
          pending={more.pending}
          onClick={loadMore}
        >
          {common('loadMore')}
        </Button>
      )}
    </Section>
  );
}
