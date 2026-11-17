'use client';

import type {
  AskSourceLabelDto,
  VoiceDraft,
  VoiceRoomMessage,
  VoiceSessionResponse,
  VoiceState,
} from '@shakti/contracts';
import { Button, cn, Field, Select, Textarea } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import { draftDirective } from '../../actions/playbook';
import { sourceHref } from '../../screens/ask';
import { FailureMessage } from '../screens/failure';
import { signInAfter, useCommand, type CommandFailure } from '../screens/use-command';
import { voiceRoomConnector, type VoiceRoom } from './room';

type Mode = 'ask' | 'teach';
type EndReason = Extract<VoiceRoomMessage, { type: 'ended' }>['reason'];

interface Caption {
  id: number;
  speaker: 'person' | 'shakti';
  text: string;
}

interface Live {
  room: VoiceRoom;
  mode: Mode;
  state: VoiceState;
  minutesLeft: number;
  captions: Caption[];
  cards: AskSourceLabelDto[];
  drafts: VoiceDraft[];
}

/** The longest typed question (`VoicePageMessage.text`). */
const TEXT_MAX = 2000;

/**
 * `/voice` (docs/03-roadmap-appendix/phase2.md §7.5): the recording question before each talk,
 * then the listening light, the captions, the cited records of an answer, Teach's drafts with a
 * Save on each, push-to-talk and a text box when the connection is weak, and the minutes left.
 */
export function VoiceScreen({
  setUp,
  minutesLeft,
  sessionMaxMinutes,
  companies,
}: {
  setUp: boolean;
  minutesLeft: number;
  sessionMaxMinutes: number;
  companies: readonly { id: number; name: string }[];
}) {
  const t = useTranslations('voice');
  const [mode, setMode] = useState<Mode>('ask');
  const [record, setRecord] = useState<'yes' | 'no' | undefined>();
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<CommandFailure | undefined>();
  const [live, setLive] = useState<Live | undefined>();
  const [ended, setEnded] = useState<EndReason | undefined>();
  const [left, setLeft] = useState(minutesLeft);
  const captionId = useRef(0);

  function fail(error: string) {
    const to = signInAfter(error, window.location.pathname);
    if (to !== undefined) window.location.assign(to);
    setFailure((previous) => ({ error, attempt: (previous?.attempt ?? 0) + 1 }));
  }

  function onMessage(message: VoiceRoomMessage) {
    if (message.type === 'ended') {
      setEnded(message.reason);
      setLive(undefined);
      return;
    }
    setLive((current) => {
      if (current === undefined) return current;
      switch (message.type) {
        case 'state':
          return { ...current, state: message.state };
        case 'minutes':
          setLeft(message.minutesLeft);
          return { ...current, minutesLeft: message.minutesLeft };
        case 'caption':
          captionId.current += 1;
          return {
            ...current,
            captions: [
              ...current.captions,
              { id: captionId.current, speaker: message.speaker, text: message.text },
            ],
          };
        case 'cards':
          return { ...current, cards: message.cards };
        case 'draft':
          return { ...current, drafts: [...current.drafts, message.draft] };
      }
    });
  }

  async function start(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (record === undefined || starting) return;
    setFailure(undefined);
    setEnded(undefined);
    const connector = voiceRoomConnector();
    setStarting(true);
    try {
      // No room in this browser yet: nothing is started on the BOS either.
      if (window.shaktiVoiceRoom === undefined) {
        fail('voice_unavailable');
        return;
      }
      const response = await fetch('/api/v1/voice/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, consentRecording: record === 'yes' }),
      });
      if (!response.ok) {
        const envelope = (await response.json().catch(() => undefined)) as
          { error?: { code?: string; details?: { reason?: string } } } | undefined;
        fail(envelope?.error?.details?.reason ?? envelope?.error?.code ?? 'internal');
        return;
      }
      const session = (await response.json()) as VoiceSessionResponse;
      const room = await connector(session.livekit);
      room.onMessage(onMessage);
      setLeft(session.limits.minutesRemainingToday);
      setLive({
        room,
        mode,
        state: 'listening',
        minutesLeft: session.limits.maxSessionMinutes,
        captions: [],
        cards: [],
        drafts: [],
      });
      await room.setMicrophone(true);
    } catch {
      fail('voice_unavailable');
    } finally {
      setStarting(false);
    }
  }

  async function end() {
    if (live === undefined) return;
    await live.room.leave();
    setLive(undefined);
    setEnded('ended');
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="text-text-muted text-sm" role="status">
        {t('minutesLeft', { minutes: left })}
      </p>
      {live === undefined ? (
        <StartForm
          setUp={setUp}
          mode={mode}
          record={record}
          starting={starting}
          sessionMaxMinutes={sessionMaxMinutes}
          noMinutes={left === 0}
          ended={ended}
          failure={failure}
          onMode={setMode}
          onRecord={setRecord}
          onStart={(e) => void start(e)}
        />
      ) : (
        <LiveTalk live={live} companies={companies} onEnd={() => void end()} />
      )}
    </div>
  );
}

function StartForm({
  setUp,
  mode,
  record,
  starting,
  sessionMaxMinutes,
  noMinutes,
  ended,
  failure,
  onMode,
  onRecord,
  onStart,
}: {
  setUp: boolean;
  mode: Mode;
  record: 'yes' | 'no' | undefined;
  starting: boolean;
  sessionMaxMinutes: number;
  noMinutes: boolean;
  ended: EndReason | undefined;
  failure: CommandFailure | undefined;
  onMode: (mode: Mode) => void;
  onRecord: (record: 'yes' | 'no') => void;
  onStart: (e: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const t = useTranslations('voice');
  if (!setUp) return <p>{t('notSetUp')}</p>;
  return (
    <form
      onSubmit={onStart}
      aria-labelledby="voice-start"
      className="flex max-w-2xl flex-col gap-5"
    >
      <h2 id="voice-start" className="text-h3">
        {ended === undefined ? t('start.heading') : t('ended.again')}
      </h2>
      {ended === undefined ? null : (
        <p role="status" className="text-text-muted text-sm">
          {t(`ended.${ended}`)}
        </p>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t('start.mode')}</legend>
        {(['ask', 'teach'] as const).map((m) => (
          <label key={m} className="flex items-start gap-3">
            <input
              type="radio"
              name="mode"
              value={m}
              checked={mode === m}
              onChange={() => {
                onMode(m);
              }}
              className="accent-accent mt-1 size-4"
            />
            <span className="flex flex-col">
              <span>{t(`start.${m}`)}</span>
              <span className="text-text-muted text-sm">{t(`start.${m}Hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2" aria-describedby="voice-recording-hint">
        <legend className="mb-1 font-medium">{t('start.recording')}</legend>
        <p id="voice-recording-hint" className="text-text-muted text-sm">
          {t('start.recordingHint')}
        </p>
        {(['yes', 'no'] as const).map((r) => (
          <label key={r} className="inline-flex min-h-8 items-center gap-3">
            <input
              type="radio"
              name="record"
              value={r}
              checked={record === r}
              required
              onChange={() => {
                onRecord(r);
              }}
              className="accent-accent size-4"
            />
            {r === 'yes' ? t('start.recordYes') : t('start.recordNo')}
          </label>
        ))}
      </fieldset>
      <p className="text-text-muted text-sm">
        {t('sessionLength', { minutes: sessionMaxMinutes })}
      </p>
      <FailureMessage failure={failure} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={record === undefined || starting || noMinutes}>
          {t('start.startButton')}
        </Button>
        <p role="status" aria-live="polite" className="text-text-muted text-sm">
          {starting ? t('start.starting') : record === undefined ? t('start.answerFirst') : ''}
        </p>
      </div>
    </form>
  );
}

function LiveTalk({
  live,
  companies,
  onEnd,
}: {
  live: Live;
  companies: readonly { id: number; name: string }[];
  onEnd: () => void;
}) {
  const t = useTranslations('voice');
  const [text, setText] = useState('');
  const pushToTalk = live.state === 'push_to_talk';

  function hold(on: boolean) {
    void live.room.setMicrophone(on);
    void live.room.send({ type: 'push_to_talk', held: on });
  }

  function send(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const words = text.trim();
    if (words === '') return;
    void live.room.send({ type: 'text', text: words });
    setText('');
  }

  return (
    <section aria-labelledby="voice-live" className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="voice-live" className="text-h3">
          {t('live.heading')}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-text-muted text-sm">
            {t('minutesLeft', { minutes: live.minutesLeft })}
          </p>
          <Button variant="secondary" onClick={onEnd}>
            {t('live.end')}
          </Button>
        </div>
      </div>
      <p role="status" aria-label={t('live.light')} className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-3 rounded-full',
            live.state === 'listening' && 'bg-success animate-pulse',
            live.state === 'thinking' && 'bg-warning',
            live.state === 'speaking' && 'bg-accent',
            live.state === 'push_to_talk' && 'bg-text-muted',
          )}
        />
        <span className="font-medium">{t(`live.${live.state}`)}</span>
      </p>

      <section aria-label={t('live.captions')} className="flex flex-col gap-2">
        {live.captions.length === 0 ? (
          <p className="text-text-muted text-sm">{t('live.noCaptions')}</p>
        ) : (
          <ol aria-live="polite" className="flex flex-col gap-2">
            {live.captions.map((c) => (
              <li
                key={c.id}
                className={cn(
                  'max-w-prose rounded-md px-3 py-2 break-words',
                  c.speaker === 'person' ? 'bg-surface-muted self-end' : 'border-border border',
                )}
              >
                <span className="text-text-muted block text-xs">
                  {c.speaker === 'person' ? t('live.you') : t('live.shakti')}
                </span>
                {c.text}
              </li>
            ))}
          </ol>
        )}
      </section>

      {live.cards.length === 0 ? null : <Cards cards={live.cards} />}

      {pushToTalk ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t('live.weakConnection')}</p>
          <div>
            <Button
              onPointerDown={() => {
                hold(true);
              }}
              onPointerUp={() => {
                hold(false);
              }}
              onPointerLeave={() => {
                hold(false);
              }}
              onKeyDown={(e) => {
                if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) hold(true);
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') hold(false);
              }}
            >
              {t('live.holdToTalk')}
            </Button>
          </div>
          <form onSubmit={send} className="flex max-w-2xl flex-col gap-3">
            <Field id="voice-text" label={t('live.typeLabel')}>
              <Textarea
                rows={2}
                maxLength={TEXT_MAX}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                }}
              />
            </Field>
            <div>
              <Button type="submit" variant="secondary" disabled={text.trim() === ''}>
                {t('live.send')}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {live.mode === 'teach' ? (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              void live.room.send({ type: 'make_drafts' });
            }}
          >
            {t('live.makeDrafts')}
          </Button>
        </div>
      ) : null}
      {live.drafts.length === 0 ? null : <Drafts drafts={live.drafts} companies={companies} />}
    </section>
  );
}

/** The records an answer comes from, each a link to its screen where it has one. */
function Cards({ cards }: { cards: readonly AskSourceLabelDto[] }) {
  const t = useTranslations('voice');
  const ask = useTranslations('ask');
  return (
    <section aria-label={t('live.cards')} className="flex flex-col gap-2">
      <h3 className="text-text-muted text-sm font-medium">{t('live.cards')}</h3>
      <ul className="flex flex-wrap gap-2">
        {cards.map((card) => {
          const href = sourceHref(card);
          const words = card.label ?? ask(`kind.${card.kind}`);
          return (
            <li
              key={card.id}
              className="border-border bg-surface flex min-w-40 flex-col rounded-md border px-3 py-2 text-sm"
            >
              <span className="text-text-muted text-xs">{ask(`kind.${card.kind}`)}</span>
              {href === undefined ? (
                <span>{words}</span>
              ) : (
                <a href={href} className="text-accent-text underline-offset-2 hover:underline">
                  {words}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Teach's drafts: each saved by the person, through the Playbook's own command. */
function Drafts({
  drafts,
  companies,
}: {
  drafts: readonly VoiceDraft[];
  companies: readonly { id: number; name: string }[];
}) {
  const t = useTranslations('voice');
  return (
    <section aria-labelledby="voice-drafts" className="flex flex-col gap-3">
      <h3 id="voice-drafts" className="text-h3">
        {t('drafts.heading')}
      </h3>
      <p className="text-text-muted text-sm">{t('drafts.intro')}</p>
      <ul className="flex flex-col gap-3">
        {drafts.map((draft) => (
          <li key={draft.id}>
            <DraftCard draft={draft} companies={companies} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DraftCard({
  draft,
  companies,
}: {
  draft: VoiceDraft;
  companies: readonly { id: number; name: string }[];
}) {
  const t = useTranslations('voice');
  const playbook = useTranslations('playbook');
  const save = useCommand(draftDirective);
  const [company, setCompany] = useState(companies[0]?.id ?? 1);
  const [saved, setSaved] = useState(false);
  return (
    <article
      aria-label={draft.title}
      className="border-border bg-surface flex flex-col gap-2 rounded-md border p-4"
    >
      <p className="text-text-muted text-xs">
        {t('drafts.kind', {
          type: playbook(`type.${draft.type}`),
          audience: playbook(`audience.${draft.audience}`),
        })}
      </p>
      <h4 className="font-medium break-words">{draft.title}</h4>
      <p className="break-words whitespace-pre-line">{draft.text}</p>
      {saved ? (
        <p role="status" className="text-sm">
          {t('drafts.saved')}
        </p>
      ) : (
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.run(
              {
                entityId: company,
                type: draft.type,
                audience: draft.audience,
                title: draft.title,
                text: draft.text,
              },
              () => {
                setSaved(true);
              },
            );
          }}
        >
          {companies.length > 1 ? (
            <Field
              id={`voice-draft-company-${draft.id}`}
              label={t('drafts.company')}
              actions={
                <Button type="submit" disabled={save.pending}>
                  {t('drafts.save')}
                </Button>
              }
            >
              <Select
                value={company}
                onChange={(e) => {
                  setCompany(Number(e.target.value));
                }}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Button type="submit" disabled={save.pending}>
              {t('drafts.save')}
            </Button>
          )}
          <FailureMessage failure={save.failure} />
        </form>
      )}
    </article>
  );
}
