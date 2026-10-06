'use client';

import type {
  Account360Dto,
  AccountDuplicatesDto,
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
import { openFile } from '../../actions/files';
import {
  ACCOUNT_TYPES,
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  OPPORTUNITY_STATES,
  SIZING_KINDS,
  TASK_KINDS,
} from '../../screens/contract-values';
import { customerHref, isOneOf as oneOf } from '../../screens/customers';
import { formatDate, formatDateTime, formatPhone, formatRupees } from '../../screens/format';
import { QUOTE_STATE_TONE, quoteBuilderHref, quoteHref } from '../../screens/quotes';
import { Page } from '../shell/page';
import type { UploadLimitView } from '../companies/branding-dialog';
import { FailureMessage } from '../screens/failure';
import { settle } from '../screens/settle';
import { useCommand, useQuery, type CommandFailure } from '../screens/use-command';
import type { CustomerDialogKind } from './customer-dialogs';

// The dialogs and the sizing panel load on first use, so the page ships only what it shows.
const CustomerDialog = dynamic(() => import('./customer-dialogs').then((m) => m.CustomerDialog));
const SizingPanel = dynamic(() => import('../sizing/sizing-panel').then((m) => m.SizingPanel));
// The duplicate cards load only for a customer that has one (CRM-03).
const AccountDuplicates = dynamic(() =>
  import('../duplicates/account-duplicates').then((m) => m.AccountDuplicates),
);

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
  proofLimit,
  duplicates,
}: {
  initial: Account360Dto;
  companies: Record<number, string>;
  /** The limits of proof of consent, for a caller who may record consent. */
  proofLimit?: UploadLimitView;
  /** The customer's duplicate cards and the merges into it, when it has any. */
  duplicates?: AccountDuplicatesDto | undefined;
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
          {view.canSetTier ? (
            <Button
              variant="secondary"
              onClick={() => {
                setDialog({ kind: 'tier' });
              }}
            >
              {t('account.setTier')}
            </Button>
          ) : null}
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
        {/* A caller who does not read the price tiers is not told the tier's name. */}
        {view.account.tierId !== null && view.account.tierName === null ? null : (
          <Detail label={t('account.tier')}>
            {view.account.tierName ?? t('account.tierNone')}
          </Detail>
        )}
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
      {duplicates === undefined ||
      (duplicates.candidates.length === 0 && duplicates.merges.length === 0) ? null : (
        <AccountDuplicates
          initial={duplicates}
          accountId={view.account.id}
          entityId={view.entityId}
          companies={companies}
          onChanged={reload}
        />
      )}

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
          <Quotes view={view} />
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
          proofLimit={proofLimit}
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
                  {p.isDnd ? (
                    // A number on the do-not-disturb list is shown, never offered for a call.
                    <span className="tabular-nums">{formatPhone(p.e164)}</span>
                  ) : (
                    <a
                      href={`tel:${p.e164}`}
                      className="text-accent-text tabular-nums hover:underline"
                    >
                      {formatPhone(p.e164)}
                    </a>
                  )}
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
              {s.pinNeedsReview ? (
                <span className="text-warning text-sm">{t('sites.pinNeedsReview')}</span>
              ) : null}
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
              {c.evidenceFileId !== null ? (
                <ProofLink fileId={c.evidenceFileId} />
              ) : c.hasEvidence ? (
                <span className="text-text-muted text-sm">{t('consent.proofKept')}</span>
              ) : null}
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

/**
 * Opens the proof of a consent in a new tab through a short-lived address. The tab is opened on
 * the click itself, so no pop-up blocker stops it; the address is filled in when it arrives.
 */
function ProofLink({ fileId }: { fileId: string }) {
  const t = useTranslations('customers');
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<CommandFailure | undefined>();
  return (
    <span className="flex flex-col gap-1">
      <Button
        variant="link"
        size="sm"
        className="self-start px-0"
        pending={opening}
        onClick={() => {
          const tab = window.open('about:blank', '_blank');
          if (tab !== null) tab.opener = null;
          setOpening(true);
          void settle(() => openFile(fileId)).then((result) => {
            setOpening(false);
            if (result.ok) {
              setFailure(undefined);
              if (tab === null) window.location.assign(result.data.url);
              else tab.location.href = result.data.url;
              return;
            }
            tab?.close();
            setFailure((previous) => ({
              error: result.error,
              reference: result.reference,
              attempt: (previous?.attempt ?? 0) + 1,
            }));
          });
        }}
      >
        {t('consent.open')}
      </Button>
      <FailureMessage failure={failure} />
    </span>
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
  // The lead whose sizing panel is open: one at a time, loaded when first opened.
  const [sizing, setSizing] = useState<string | undefined>();
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
                {view.canQuote ? (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={quoteBuilderHref(view.entityId, l.id)}>{t('leads.makeQuote')}</Link>
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={sizing === l.id}
                  aria-controls={`account-sizing-${l.id}`}
                  onClick={() => {
                    setSizing((open) => (open === l.id ? undefined : l.id));
                  }}
                >
                  {sizing === l.id ? t('leads.hideSizing') : t('leads.sizeLead')}
                </Button>
              </div>
              <div id={`account-sizing-${l.id}`} hidden={sizing !== l.id} className="pt-2">
                {sizing === l.id ? (
                  <SizingPanel
                    entityId={view.entityId}
                    opportunityId={l.id}
                    canWrite={view.canWorkLeads}
                    onSaved={onChanged}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The customer's quotes in this company, newest first, each opening its quote page. */
function Quotes({ view }: { view: Account360Dto }) {
  const t = useTranslations('customers');
  const quotesT = useTranslations('quotes');
  return (
    <Section id="account-quotes" title={t('quotes.sectionTitle')}>
      {view.quotes.length === 0 ? (
        <p className="text-text-muted">{t('quotes.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {view.quotes.map((q) => (
            <li key={q.id} className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={quoteHref(q.entityId, q.id)}
                  className="text-accent-text font-medium tabular-nums hover:underline"
                >
                  {q.quoteNo}
                </Link>
                <StatusBadge tone={QUOTE_STATE_TONE[q.state]}>
                  {quotesT(`state.${q.state}`)}
                </StatusBadge>
              </div>
              <span className="text-text-muted text-sm tabular-nums">
                {t('quotes.summary', {
                  total: formatRupees(q.grandTotal),
                  date: formatDate(q.validUntil),
                })}
              </span>
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
  const sizingT = useTranslations('sizing');
  const tagName = item.payload.tagName;
  const kind = item.payload.kind;
  const detail =
    item.type === 'note'
      ? item.body
      : typeof tagName === 'string'
        ? t('timeline.tagDetail', { name: tagName })
        : item.type === 'sizing_recorded' && typeof kind === 'string' && oneOf(SIZING_KINDS, kind)
          ? t(
              item.payload.inBounds === true
                ? 'timeline.sizingInBounds'
                : 'timeline.sizingOutOfBounds',
              {
                kind: sizingT(`kind.${kind}`),
              },
            )
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
