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
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { draftDirective } from '../../actions/playbook';
import { readVoiceToday } from '../../actions/voice';
import { sourceHref } from '../../screens/ask';
import { FailureMessage } from '../screens/failure';
import { signInAfter, useCommand, type CommandFailure } from '../screens/use-command';
import { voiceRoomConnector, voiceSupported, type VoiceConnection, type VoiceRoom } from './room';

type Mode = 'ask' | 'teach';
/** Why a talk ended: the worker's reasons, or the connection lost. */
type EndReason = Extract<VoiceRoomMessage, { type: 'ended' }>['reason'] | 'lost';

interface Caption {
  id: number;
  speaker: 'person' | 'shakti';
  text: string;
}

interface Live {
  room: VoiceRoom;
  mode: Mode;
  state: VoiceState;
  /** The room is finding its way back after the network dropped. */
  reconnecting: boolean;
  /** The browser holds Shakti's voice until the person turns sound on. */
  soundBlocked: boolean;
  /** The minutes left in this talk, as the worker reports them. */
  minutesLeft: number;
  /** The day's minutes left when the talk started, and the talk's own longest length. */
  dayMinutesAtStart: number;
  talkMinutes: number;
  captions: Caption[];
  cards: AskSourceLabelDto[];
  drafts: VoiceDraft[];
}

/** The longest typed question (`VoicePageMessage.text`). */
const TEXT_MAX = 2000;

/** The day's minutes left during a talk: those at its start, less the talk's minutes so far. */
export function dayMinutesLeft(
  live: Pick<Live, 'dayMinutesAtStart' | 'talkMinutes' | 'minutesLeft'>,
) {
  return Math.max(0, live.dayMinutesAtStart - (live.talkMinutes - live.minutesLeft));
}

/**
 * `/voice` (docs/03-roadmap-appendix/phase2.md §7.5): the recording question before each talk,
 * then the listening light, the captions, the cited records of an answer, Teach's drafts with a
 * Save on each, push-to-talk and a text box when the connection is weak. The minutes left today
 * and the minutes left in the talk are kept apart: the worker reports the talk's, and the day's
 * come from the server again after every talk. The recording answer is cleared after every talk
 * and every failed start, so it is asked before each one.
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
  const [talkLength, setTalkLength] = useState(sessionMaxMinutes);
  const captionId = useRef(0);
  // The room of the talk under way, left when the talk ends or the page closes.
  const roomRef = useRef<VoiceRoom | undefined>(undefined);

  useEffect(
    () => () => {
      void roomRef.current?.leave();
      roomRef.current = undefined;
    },
    [],
  );

  function fail(error: string) {
    const to = signInAfter(error, window.location.pathname);
    if (to !== undefined) window.location.assign(to);
    setFailure((previous) => ({ error, attempt: (previous?.attempt ?? 0) + 1 }));
  }

  /** The day's minutes from the server again; the screen keeps what it had if that fails. */
  async function refreshToday() {
    const today = await readVoiceToday().catch(() => undefined);
    if (today?.ok !== true) return;
    setLeft(today.data.minutesLeft);
    setTalkLength(today.data.sessionMaxMinutes);
  }

  /** A start that did not become a talk: the recording question is asked again. */
  function failStart(error: string) {
    setRecord(undefined);
    fail(error);
  }

  /** Leaves the room, if this talk still holds it, and shows the start form with the reason. */
  function finish(room: VoiceRoom, reason: EndReason) {
    if (roomRef.current !== room) return;
    roomRef.current = undefined;
    void room.leave();
    setLive(undefined);
    setEnded(reason);
    // Asked again before the next talk; the day's minutes as the server now counts them.
    setRecord(undefined);
    void refreshToday();
  }

  function onMessage(room: VoiceRoom, message: VoiceRoomMessage) {
    if (roomRef.current !== room) return;
    if (message.type === 'ended') {
      finish(room, message.reason);
      return;
    }
    // A weak connection: the microphone is on only while the hold button is held.
    if (message.type === 'state' && message.state === 'push_to_talk') {
      void room.setMicrophone(false);
    }
    setLive((current) => {
      if (current === undefined) return current;
      switch (message.type) {
        case 'state':
          return { ...current, state: message.state };
        case 'minutes':
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

  function onConnection(room: VoiceRoom, connection: VoiceConnection) {
    if (roomRef.current !== room) return;
    if (connection === 'lost') {
      finish(room, 'lost');
      return;
    }
    setLive((current) =>
      current === undefined ? current : { ...current, reconnecting: connection === 'reconnecting' },
    );
  }

  function onSoundBlocked(room: VoiceRoom, soundBlocked: boolean) {
    if (roomRef.current !== room) return;
    setLive((current) => (current === undefined ? current : { ...current, soundBlocked }));
  }

  async function start(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (record === undefined || starting) return;
    setFailure(undefined);
    setEnded(undefined);
    // A browser that cannot hold a talk: nothing is started on the BOS either.
    if (!voiceSupported()) {
      failStart('voice_browser');
      return;
    }
    const connector = voiceRoomConnector();
    setStarting(true);
    try {
      const response = await fetch('/api/v1/voice/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, consentRecording: record === 'yes' }),
      });
      if (!response.ok) {
        const envelope = (await response.json().catch(() => undefined)) as
          { error?: { code?: string; details?: { reason?: string } } } | undefined;
        failStart(envelope?.error?.details?.reason ?? envelope?.error?.code ?? 'internal');
        void refreshToday();
        return;
      }
      const session = (await response.json()) as VoiceSessionResponse;
      let room: VoiceRoom;
      try {
        room = await connector(session.livekit);
      } catch {
        failStart('voice_connection');
        void refreshToday();
        return;
      }
      roomRef.current = room;
      setLeft(session.limits.minutesRemainingToday);
      setLive({
        room,
        mode,
        state: 'listening',
        reconnecting: false,
        soundBlocked: false,
        minutesLeft: session.limits.maxSessionMinutes,
        dayMinutesAtStart: session.limits.minutesRemainingToday,
        talkMinutes: session.limits.maxSessionMinutes,
        captions: [],
        cards: [],
        drafts: [],
      });
      // After the talk is shown: the room hands each handler what came before it.
      room.onMessage((message) => {
        onMessage(room, message);
      });
      room.onConnection((connection) => {
        onConnection(room, connection);
      });
      room.onSoundBlocked((blocked) => {
        onSoundBlocked(room, blocked);
      });
      try {
        await room.setMicrophone(true);
      } catch {
        // The person said no to the microphone, or the browser has none.
        if (roomRef.current === room) {
          roomRef.current = undefined;
          void room.leave();
          setLive(undefined);
          failStart('voice_microphone');
          void refreshToday();
        }
      }
    } catch {
      failStart('voice_connection');
    } finally {
      setStarting(false);
    }
  }

  function end() {
    const room = roomRef.current;
    if (room !== undefined) finish(room, 'ended');
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="text-text-muted text-sm" role="status">
        {t('minutesLeft', { minutes: live === undefined ? left : dayMinutesLeft(live) })}
      </p>
      {live === undefined ? (
        <StartForm
          setUp={setUp}
          mode={mode}
          record={record}
          starting={starting}
          sessionMaxMinutes={talkLength}
          noMinutes={left === 0}
          ended={ended}
          failure={failure}
          onMode={setMode}
          onRecord={setRecord}
          onStart={(e) => void start(e)}
        />
      ) : (
        <LiveTalk live={live} companies={companies} onEnd={end} />
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
            {t('live.talkMinutesLeft', { minutes: live.minutesLeft })}
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
      <p role="status" className="text-sm empty:hidden">
        {live.reconnecting ? t('live.reconnecting') : ''}
      </p>
      {live.soundBlocked ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">{t('live.soundBlocked')}</p>
          <Button
            variant="secondary"
            onClick={() => {
              void live.room.startSound();
            }}
          >
            {t('live.turnOnSound')}
          </Button>
        </div>
      ) : null}

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
