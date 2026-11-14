'use client';

import type {
  AskConversationDetailDto,
  AskConversationDto,
  AskConversationPageDto,
  AskLookup,
  AskMessageDto,
  AskSourceLabelDto,
  AskStreamEvent,
} from '@shakti/contracts';
import { Button, cn, EmptyState, Field, Textarea } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import {
  deleteAskConversation,
  listAskConversations,
  readAskConversation,
} from '../../actions/ask';
import {
  answerFigures,
  answerParts,
  citationNumbers,
  sourceHref,
  type AnswerPart,
} from '../../screens/ask';
import { formatDateTime } from '../../screens/format';
import { signInAfter } from '../screens/use-command';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery, type CommandFailure } from '../screens/use-command';

/** The longest question the route takes (`ASK_QUESTION_MAX`). */
const QUESTION_MAX = 2000;

interface Open {
  conversation: AskConversationDto;
  messages: AskMessageDto[];
  sources: Map<string, AskSourceLabelDto>;
}

const byId = (sources: readonly AskSourceLabelDto[]) => new Map(sources.map((s) => [s.id, s]));

/**
 * `/ask` (docs/03-roadmap-appendix/phase2.md §6.5): the person's conversations, the one open, and
 * the question box. A question goes to `POST /api/v1/ask`, whose lines name each lookup as it
 * runs and end with the answer once the grounding filter has passed it.
 */
export function AskScreen({
  initial,
  companyNames,
}: {
  initial: AskConversationPageDto;
  companyNames: Readonly<Record<number, string>>;
}) {
  const t = useTranslations('ask');
  const [conversations, setConversations] = useState(initial.conversations);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [open, setOpen] = useState<Open | undefined>();
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [lookups, setLookups] = useState<AskLookup[]>([]);
  const [failure, setFailure] = useState<CommandFailure | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState('');
  const read = useQuery<AskConversationDetailDto>();
  const more = useQuery<AskConversationPageDto>();
  const remove = useCommand(deleteAskConversation);
  const box = useRef<HTMLTextAreaElement>(null);

  function fail(error: string) {
    const to = signInAfter(error, window.location.pathname);
    if (to !== undefined) window.location.assign(to);
    setFailure((previous) => ({ error, attempt: (previous?.attempt ?? 0) + 1 }));
  }

  function choose(conversation: AskConversationDto) {
    setNotice('');
    setConfirming(false);
    setFailure(undefined);
    read.load(
      () => readAskConversation({ conversationId: conversation.id }),
      (detail) => {
        setOpen({
          conversation: detail.conversation,
          messages: detail.messages,
          sources: byId(detail.sources),
        });
        box.current?.focus();
      },
    );
  }

  function startNew() {
    setOpen(undefined);
    setConfirming(false);
    setFailure(undefined);
    setNotice('');
    box.current?.focus();
  }

  function answered(event: Extract<AskStreamEvent, { type: 'answer' }>) {
    const { conversation, message } = event.turn;
    setOpen((current) => ({
      conversation,
      messages:
        current?.conversation.id === conversation.id ? [...current.messages, message] : [message],
      sources: new Map([...(current?.sources ?? []), ...byId(event.sources)]),
    }));
    setConversations((all) => [conversation, ...all.filter((c) => c.id !== conversation.id)]);
    setQuestion('');
  }

  async function ask(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = question.trim();
    if (text === '' || asking) return;
    setAsking(true);
    setLookups([]);
    setFailure(undefined);
    setNotice('');
    try {
      const response = await fetch('/api/v1/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ conversationId: open?.conversation.id ?? null, question: text }),
      });
      if (!response.ok || response.body === null) {
        const envelope = (await response.json().catch(() => undefined)) as
          { error?: { code?: string; details?: { reason?: string } } } | undefined;
        fail(envelope?.error?.details?.reason ?? envelope?.error?.code ?? 'internal');
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += value;
        const lines = rest.split('\n');
        rest = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() === '') continue;
          const event = JSON.parse(line) as AskStreamEvent;
          if (event.type === 'lookup') setLookups((all) => [...all, event.lookup]);
          else if (event.type === 'answer') answered(event);
          else fail(event.error.reason ?? event.error.code);
        }
      }
    } catch {
      fail('internal');
    } finally {
      setAsking(false);
      setLookups([]);
    }
  }

  function deleteOpen() {
    if (open === undefined) return;
    const id = open.conversation.id;
    remove.run({ conversationId: id }, () => {
      setConversations((all) => all.filter((c) => c.id !== id));
      setOpen(undefined);
      setConfirming(false);
      setNotice(t('delete.done'));
    });
  }

  function loadMore() {
    if (cursor === null) return;
    more.load(
      () => listAskConversations({ cursor }),
      (page) => {
        setConversations((all) => [...all, ...page.conversations]);
        setCursor(page.nextCursor);
      },
    );
  }

  const covers = (c: AskConversationDto) =>
    c.entityIds.map((e) => companyNames[e] ?? String(e)).join(', ');

  return (
    <div className="grid min-w-0 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <nav aria-labelledby="ask-conversations" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ask-conversations" className="text-h3">
            {t('conversations.heading')}
          </h2>
          <Button variant="secondary" size="sm" onClick={startNew}>
            {t('conversations.newConversation')}
          </Button>
        </div>
        <FailureMessage failure={more.failure} />
        {conversations.length === 0 ? (
          <EmptyState message={t('conversations.empty')} />
        ) : (
          <ul className="flex flex-col gap-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    choose(c);
                  }}
                  aria-current={open?.conversation.id === c.id ? 'true' : undefined}
                  className={cn(
                    'hover:bg-highlight focus-visible:outline-focus flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2',
                    open?.conversation.id === c.id && 'bg-highlight',
                  )}
                >
                  <span className="line-clamp-2 text-sm font-medium break-words">{c.title}</span>
                  <span className="text-text-subtle text-xs">
                    <time dateTime={c.updatedAt}>{formatDateTime(c.updatedAt)}</time>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {cursor === null ? null : (
          <Button variant="ghost" size="sm" onClick={loadMore} disabled={more.pending}>
            {t('conversations.loadMore')}
          </Button>
        )}
        <p className="text-text-subtle text-xs">{t('conversations.kept')}</p>
      </nav>

      <section aria-labelledby="ask-open" className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="ask-open" className="text-h3 break-words">
              {open?.conversation.title ?? t('conversations.newConversation')}
            </h2>
            {open === undefined ? null : (
              <p className="text-text-muted text-sm">
                {t('conversations.covers', { companies: covers(open.conversation) })}
              </p>
            )}
          </div>
          {open === undefined ? null : confirming ? (
            <div
              role="group"
              aria-label={t('delete.question')}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-sm">{t('delete.question')}</span>
              <Button variant="danger" size="sm" onClick={deleteOpen} disabled={remove.pending}>
                {t('delete.deleteForGood')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t('delete.keepIt')}
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {t('delete.deleteButton')}
            </Button>
          )}
        </div>
        <p role="status" className="text-text-muted text-sm empty:hidden">
          {notice}
        </p>
        <FailureMessage failure={read.failure ?? remove.failure} />

        {open === undefined ? null : (
          <ol className="flex flex-col gap-6">
            {open.messages.map((m) => (
              <li key={m.id}>
                <Turn message={m} sources={open.sources} />
              </li>
            ))}
          </ol>
        )}

        <form onSubmit={(e) => void ask(e)} className="flex flex-col gap-3">
          <Field
            id="ask-question"
            label={t('composer.label')}
            {...(open === undefined ? {} : { helper: t('composer.followUp') })}
          >
            <Textarea
              ref={box}
              rows={3}
              maxLength={QUESTION_MAX}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
              }}
            />
          </Field>
          <FailureMessage failure={failure} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={asking || question.trim() === ''}>
              {t('composer.askButton')}
            </Button>
            <p role="status" aria-live="polite" className="text-text-muted text-sm">
              {asking
                ? lookups.length === 0
                  ? t('composer.working')
                  : t(`lookup.${lookups.at(-1) ?? 'list_leads'}`)
                : ''}
            </p>
          </div>
        </form>
      </section>
    </div>
  );
}

/** One question and its answer: the answer's text with its citations, its figures and sources. */
function Turn({
  message,
  sources,
}: {
  message: AskMessageDto;
  sources: ReadonlyMap<string, AskSourceLabelDto>;
}) {
  const t = useTranslations('ask');
  const numbers = citationNumbers(message.answer);
  const figures = answerFigures(message.answer);
  const cited = [...numbers.keys()];
  return (
    <article className="flex flex-col gap-3">
      <div className="bg-surface-muted self-end rounded-md px-4 py-2">
        <p className="sr-only">{t('answer.you')}</p>
        <p className="break-words whitespace-pre-line">{message.question}</p>
      </div>
      <div className="border-border bg-surface flex flex-col gap-3 rounded-md border p-4">
        {message.outcome === 'no_answer' ? (
          <p>{t('answer.noAnswer')}</p>
        ) : (
          answerParts(message.answer).map((paragraph, i) => (
            <p key={i} className="break-words">
              {paragraph.map((part, j) => (
                <Part key={j} part={part} numbers={numbers} sources={sources} />
              ))}
            </p>
          ))
        )}
        {message.unsourced > 0 ? (
          <p className="text-text-muted text-sm">{t('answer.unsourcedNote')}</p>
        ) : null}
        {figures.length === 0 ? null : (
          <section aria-label={t('answer.figures')}>
            <ul className="flex flex-wrap gap-2">
              {figures.map((f) => {
                const source = f.sourceId === undefined ? undefined : sources.get(f.sourceId);
                return (
                  <li
                    key={f.value}
                    className="border-border bg-surface-muted flex min-w-32 flex-col rounded-md border px-3 py-2"
                  >
                    <span className="text-lg font-semibold tabular-nums">{f.value}</span>
                    {source?.label === undefined || source.label === null ? null : (
                      <span className="text-text-muted text-xs">{source.label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {cited.length === 0 ? null : (
          <section aria-label={t('answer.sources')} className="flex flex-col gap-2">
            <h3 className="text-text-muted text-sm font-medium">{t('answer.sources')}</h3>
            <ol className="flex flex-col gap-1">
              {cited.map((id) => {
                const source = sources.get(id);
                const href = source === undefined ? undefined : sourceHref(source);
                const words = source?.label ?? t('answer.sourceGone');
                return (
                  <li key={id} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="text-text-subtle tabular-nums">{numbers.get(id)}.</span>
                    {source === undefined ? null : (
                      <span className="text-text-muted">{t(`kind.${source.kind}`)}</span>
                    )}
                    {href === undefined ? (
                      <span>{words}</span>
                    ) : (
                      <a
                        href={href}
                        className="text-accent-text underline-offset-2 hover:underline"
                      >
                        {words}
                      </a>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>
    </article>
  );
}

/** One run of an answer: words, a numbered citation, or the sentence for a figure taken out. */
function Part({
  part,
  numbers,
  sources,
}: {
  part: AnswerPart;
  numbers: ReadonlyMap<string, number>;
  sources: ReadonlyMap<string, AskSourceLabelDto>;
}) {
  const t = useTranslations('ask');
  if (part.kind === 'text') return <>{part.text}</>;
  if (part.kind === 'unsourced') return <em>{t('answer.unsourcedFigure')}</em>;
  const number = numbers.get(part.id) ?? 0;
  const source = sources.get(part.id);
  const href = source === undefined ? undefined : sourceHref(source);
  const label = t('answer.sourceNumber', { number });
  const mark = (
    <>
      <span aria-hidden="true">[{number}]</span>
      <span className="sr-only">{label}</span>
    </>
  );
  return (
    <sup className="ms-0.5">
      {href === undefined ? (
        mark
      ) : (
        <a href={href} className="text-accent-text">
          {mark}
        </a>
      )}
    </sup>
  );
}
