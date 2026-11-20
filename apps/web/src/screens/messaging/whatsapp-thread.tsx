'use client';

import type { ThreadViewDto, WhatsAppMessageDto } from '@shakti/contracts';
import { Button, EmptyState, Field, Input, Select, StatusBadge, Textarea, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { forwardRef, useEffect, useId, useState } from 'react';
import { openFile } from '../../actions/files';
import {
  loadThread,
  returnThread,
  sendWhatsAppMessage,
  takeOverThread,
} from '../../actions/messaging';
import { FailureMessage } from '../../components/screens/failure';
import { ConciergeDraftLine } from '../concierge/draft-line';
import { draftLineKey } from '../concierge/keys';
import { useCommand, useQuery } from '../../components/screens/use-command';
import { MESSAGING_REFUSALS, WHATSAPP_MESSAGE_STATUSES } from '../contract-values';
import { customerHref, isOneOf } from '../customers';
import { sizeParts } from '../files';
import { formatDateTime, formatPhone } from '../format';

/**
 * One WhatsApp chat (docs/03-roadmap-appendix/phase2.md §6.1): its messages oldest first with each
 * outbound message's status, files opened through their checks, the reply window, the opt-out and
 * who answers; a reply box while the window is open, else the company's approved templates. The
 * customer's text is shown as stored, masked. Every change goes through its command, then the chat
 * is read again.
 */
export const WhatsAppThread = forwardRef<
  HTMLTextAreaElement,
  { entityId: number; threadId: string; initial?: ThreadViewDto | undefined }
>(function WhatsAppThread({ entityId, threadId, initial }, replyRef) {
  const t = useTranslations('messaging.thread');
  const id = useId();
  const [view, setView] = useState<ThreadViewDto | undefined>(initial);
  const [earlier, setEarlier] = useState<WhatsAppMessageDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  // How often the chat was read again: the assistant's draft is read with it.
  const [reads, setReads] = useState(0);
  const read = useQuery<ThreadViewDto>();
  const more = useQuery<ThreadViewDto>();

  function reload() {
    read.load(
      () => loadThread({ entityId, threadId }),
      (data) => {
        setView(data);
        setEarlier([]);
        setCursor(data.nextCursor);
        setReads((n) => n + 1);
      },
    );
  }

  useEffect(() => {
    if (initial === undefined) reload();
    // Read once for the chat it is given; a new chat mounts afresh (its key).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload is the same read for this chat
  }, []);

  if (view === undefined) {
    return <FailureMessage failure={read.failure} />;
  }
  const { thread } = view;
  // The page's newest messages first, then the earlier pages; shown oldest first.
  const messages = [...view.messages, ...earlier].reverse();

  return (
    <div className="flex min-w-0 flex-col gap-3" aria-busy={read.pending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">
            {thread.customerName ??
              (thread.number === null
                ? t('numberRemoved')
                : t('chatWith', { number: formatPhone(thread.number) }))}
          </p>
          {thread.number === null ? null : (
            <p className="text-text-muted text-sm">{formatPhone(thread.number)}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {thread.optedOut ? <StatusBadge tone="danger">{t('optedOut')}</StatusBadge> : null}
          <StatusBadge tone={thread.handledBy === 'people' ? 'accent' : 'neutral'}>
            {t(thread.handledBy)}
          </StatusBadge>
          {view.canSend ? <Handover entityId={entityId} view={view} onChanged={reload} /> : null}
        </div>
      </div>
      {view.assistantOn ? null : <p className="text-text-muted text-sm">{t('peopleOnly')}</p>}
      <FailureMessage failure={read.failure ?? more.failure} />
      {thread.accountId === null && thread.number !== null ? (
        <Holders view={view} entityId={entityId} />
      ) : null}
      {cursor === null ? null : (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          disabled={more.pending}
          onClick={() => {
            more.load(
              () => loadThread({ entityId, threadId, cursor }),
              (data) => {
                setEarlier((shown) => [...shown, ...data.messages]);
                setCursor(data.nextCursor);
              },
            );
          }}
        >
          {t('showEarlier')}
        </Button>
      )}
      <ol aria-label={t('messagesLabel')} className="flex flex-col gap-2">
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} />
        ))}
      </ol>
      <p className="text-text-muted text-sm">
        {thread.windowOpen && thread.windowOpenUntil !== null
          ? t.rich('windowOpen', {
              when: formatDateTime(thread.windowOpenUntil),
              time: (chunks) => <time dateTime={thread.windowOpenUntil ?? ''}>{chunks}</time>,
            })
          : t('windowClosed')}
      </p>
      {view.canSend && !thread.optedOut ? (
        <ConciergeDraftLine
          key={draftLineKey(view.messages[0]?.id, reads)}
          entityId={entityId}
          threadId={thread.id}
          onDecided={reload}
        />
      ) : null}
      {thread.optedOut ? (
        <p className="text-text-muted text-sm">{t('optedOutNote')}</p>
      ) : view.canSend ? (
        <Composer
          key={String(view.messages[0]?.id)}
          ref={replyRef}
          id={id}
          entityId={entityId}
          view={view}
          onSent={reload}
        />
      ) : (
        <p className="text-text-muted text-sm">{t('readOnly')}</p>
      )}
    </div>
  );
});

/** Why a person takes a chat over from this screen: someone asked for a person. */
const PERSON_HANDOFF = 'request';

/**
 * Take the chat over from the assistant, or give it back; while no assistant answers chats
 * (`assistantOn` false), a chat with people stays with them and nothing is offered.
 */
function Handover({
  entityId,
  view,
  onChanged,
}: {
  entityId: number;
  view: ThreadViewDto;
  onChanged: () => void;
}) {
  const t = useTranslations('messaging.thread');
  const take = useCommand(takeOverThread, `take:${view.thread.id}`);
  const give = useCommand(returnThread, `give:${view.thread.id}`);
  const input = { entityId, threadId: view.thread.id };
  return (
    <>
      {view.thread.handledBy === 'assistant' ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={take.pending}
          onClick={() => {
            take.run({ ...input, reason: PERSON_HANDOFF }, () => {
              toast.success(t('takenOver'));
              onChanged();
            });
          }}
        >
          {t('takeOver')}
        </Button>
      ) : view.assistantOn ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={give.pending}
          onClick={() => {
            give.run(input, () => {
              toast.success(t('givenBack'));
              onChanged();
            });
          }}
        >
          {t('giveBack')}
        </Button>
      ) : null}
      <FailureMessage failure={take.failure ?? give.failure} />
    </>
  );
}

/** The company's customers who hold an unmatched chat's number, to open the right one. */
function Holders({ view, entityId }: { view: ThreadViewDto; entityId: number }) {
  const t = useTranslations('messaging.thread');
  if (view.holders.length === 0) {
    return <p className="text-text-muted text-sm">{t('noHolders')}</p>;
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-text-muted">{t('holders')}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {view.holders.map((h) => (
          <li key={h.accountId}>
            <Link
              href={customerHref(h.accountId, entityId)}
              className="text-accent-text hover:underline"
            >
              {h.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One message: who sent it, what it says or carries, when, and how far an outbound one got. */
function MessageItem({ message }: { message: WhatsAppMessageDto }) {
  const t = useTranslations('messaging.thread');
  const inbound = message.direction === 'inbound';
  const opener = useCommand(openFile, `open:${message.id}`);
  const status =
    message.status !== null && isOneOf(WHATSAPP_MESSAGE_STATUSES, message.status)
      ? t(`status.${message.status}`)
      : null;
  return (
    <li
      className={
        inbound
          ? 'border-border bg-surface-2 flex max-w-xl flex-col gap-1 self-start rounded-lg border p-3'
          : 'border-border bg-accent-soft flex max-w-xl flex-col gap-1 self-end rounded-lg border p-3'
      }
    >
      <p className="text-text-muted text-xs">
        {inbound ? t('fromCustomer') : (message.sentByName ?? t('fromSystem'))} ·{' '}
        <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
      </p>
      {message.templateName === null ? null : (
        <p className="text-sm font-medium">
          {t('template', { name: message.templateLabel ?? t('templateUnnamed') })}
        </p>
      )}
      {message.templateParams === null || message.templateParams.length === 0 ? null : (
        <p className="text-sm">
          {t('templateValues', { values: message.templateParams.join(', ') })}
        </p>
      )}
      {message.body === null ? null : <p className="text-sm whitespace-pre-wrap">{message.body}</p>}
      {message.kind === 'media' ? (
        message.mediaSummary !== null ? (
          <RemovedFile summary={message.mediaSummary} />
        ) : message.fileId === null ? (
          <p className="text-text-muted text-sm">{t('mediaNotKept')}</p>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span>{t('file')}</span>
            <Button
              size="sm"
              variant="link"
              disabled={opener.pending}
              onClick={() => {
                opener.run(message.fileId ?? '', (opened) => {
                  window.open(opened.url, '_blank', 'noopener');
                });
              }}
            >
              {t('open')}
            </Button>
          </div>
        )
      ) : null}
      {status === null ? null : (
        <p className="text-text-muted text-xs">
          {status}
          {message.refusal !== null && isOneOf(MESSAGING_REFUSALS, message.refusal)
            ? ` · ${t(`refusal.${message.refusal}`)}`
            : ''}
        </p>
      )}
      <FailureMessage failure={opener.failure} />
    </li>
  );
}

/**
 * W2: a file the media retention job removed (docs/03-roadmap-appendix/phase2.md §11): what it
 * was, from the summary its message keeps, and that it was removed, never a link to open.
 */
function RemovedFile({ summary }: { summary: NonNullable<WhatsAppMessageDto['mediaSummary']> }) {
  const t = useTranslations('messaging.thread.removed');
  const { contentType, size, verdict, keptYears } = summary;
  // A summary is read field by field: what it could not read is left out of the line.
  const described =
    contentType !== undefined && size !== undefined && verdict !== undefined
      ? t('summary', {
          type: contentType.startsWith('image/')
            ? t('photo')
            : contentType === 'application/pdf'
              ? t('pdf')
              : t('other'),
          size: (() => {
            const parts = sizeParts(size);
            return t(parts.unit, { value: parts.value });
          })(),
          verdict: t(`verdict.${verdict}`),
        })
      : null;
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      {described === null ? null : <p>{described}</p>}
      <p className="text-text-muted">
        {keptYears === undefined ? t('noticePlain') : t('notice', { years: keptYears })}
      </p>
    </div>
  );
}

/** The reply box while the window is open, else the approved templates with their blanks. */
const Composer = forwardRef<
  HTMLTextAreaElement,
  { id: string; entityId: number; view: ThreadViewDto; onSent: () => void }
>(function Composer({ id, entityId, view, onSent }, replyRef) {
  const t = useTranslations('messaging.thread');
  const send = useCommand(sendWhatsAppMessage, `send:${view.thread.id}`);
  const [body, setBody] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const open = view.thread.windowOpen;
  const template = view.templates.find((tpl) => tpl.name === templateName);
  const done = () => {
    toast.success(t('sent'));
    onSent();
  };

  if (open) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send.run({ entityId, threadId: view.thread.id, kind: 'text', body }, done);
        }}
      >
        <Field
          id={`${id}-reply`}
          label={t('reply')}
          helper={t('replyHelper')}
          actions={
            <Button type="submit" disabled={send.pending || body.trim() === ''}>
              {t('send')}
            </Button>
          }
        >
          <Textarea
            ref={replyRef}
            rows={2}
            maxLength={4096}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
        </Field>
        <FailureMessage failure={send.failure} />
      </form>
    );
  }
  if (view.templates.length === 0) {
    return <EmptyState message={t('noTemplates')} />;
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        send.run(
          { entityId, threadId: view.thread.id, kind: 'template', templateName, params: values },
          done,
        );
      }}
    >
      <Field id={`${id}-template`} label={t('templateLabel')}>
        <Select
          value={templateName}
          onChange={(e) => {
            const next = view.templates.find((tpl) => tpl.name === e.target.value);
            setTemplateName(e.target.value);
            setValues(next === undefined ? [] : next.params.map(() => ''));
          }}
        >
          <option value="">{t('templateChoose')}</option>
          {view.templates.map((tpl) => (
            <option key={tpl.id} value={tpl.name}>
              {tpl.label}
            </option>
          ))}
        </Select>
      </Field>
      {template?.params.map((meaning, index) => (
        <Field
          key={`${template.name}-${String(index)}`}
          id={`${id}-value-${String(index)}`}
          label={meaning}
        >
          <Input
            maxLength={1024}
            value={values[index] ?? ''}
            onChange={(e) => {
              setValues((shown) => shown.map((v, i) => (i === index ? e.target.value : v)));
            }}
          />
        </Field>
      ))}
      <Button
        type="submit"
        className="self-start"
        disabled={send.pending || template === undefined || values.some((v) => v.trim() === '')}
      >
        {t('sendTemplate')}
      </Button>
      <FailureMessage failure={send.failure} />
    </form>
  );
});
