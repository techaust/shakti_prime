import type {
  AskSourceLabelDto,
  TalkPromptName,
  VoiceDispatchMetadata,
  VoiceDraft,
  VoicePageMessage,
  VoiceState,
  VoiceTurnStats,
  VoiceTurnStep,
} from '@shakti/contracts';
import {
  percentile,
  type Clock,
  type ReplyUsage,
  type StreamingSpeechToText,
  type StreamingTextToSpeech,
  type SttStream,
  type TtsStream,
} from '@shakti/voice';
import { said } from './prompts';
import { AUDIO_IN_SAMPLE_RATE, type RoomPort } from './room';
import { SpendMeter } from './spend';
import type { WavRecorder } from './wav-recorder';

/**
 * One "Talk to Shakti" session in the room (docs/03-roadmap-appendix/phase2.md §7.5, §9.3): the
 * person's speech streams to speech-to-text; each settled transcript is a turn, answered sentence
 * by sentence, each sentence spoken as soon as it ends; the person speaking over Shakti stops it
 * at once (barge-in); captions and the listening light go to the page. When the speech service
 * fails the session falls back to push-to-talk and typed questions. Every turn is timed by step,
 * and the session ends itself at its longest length, at the day's spend, or when the BOS stops
 * refreshing its token (the token's refusal past `notAfter` is the BOS's own backstop).
 */

/** What answers a turn: Ask through the BOS, Teach through the model. */
export interface Responder {
  respond(
    text: string,
    turn: { signal: AbortSignal; onSentence: (sentence: string) => void },
  ): Promise<{ usage?: ReplyUsage; cards?: AskSourceLabelDto[] }>;
  /** Teach only: the interview so far as drafted directives. */
  makeDrafts?(signal: AbortSignal): Promise<{ drafts: VoiceDraft[]; usage?: ReplyUsage }>;
}

/** The parts of the BOS client the session uses. */
export interface SessionBos {
  stop(): void;
  uploadRecording(wav: Uint8Array): Promise<{ fileId: string; linked: boolean }>;
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (timer: unknown) => void;
}

export interface SessionDeps {
  room: RoomPort;
  metadata: VoiceDispatchMetadata;
  bos: SessionBos;
  responder: Responder;
  /** Undefined when the speech services are not set up: push-to-talk text only. */
  stt: StreamingSpeechToText | undefined;
  tts: StreamingTextToSpeech | undefined;
  /** The steps' clock, the one the speech adapters stamp their events with. */
  clock: Clock;
  /** Wall time, for the session's hard end (`notAfter`). */
  wallNow: () => number;
  timers: Timers;
  languageCode: string;
  /** Present for a Teach session the person let be recorded. */
  recorder?: WavRecorder;
  /** Problems worth an operator's look: ids and codes only, never words or audio. */
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export type EndReason = 'time_up' | 'day_limit' | 'ended' | 'failed';

/** The session ends this long before the BOS stops its token, to file what it holds. */
export const END_MARGIN_MS = 30_000;

/**
 * How long the worker waits for the person to join its room: past it (a blocked connection, a
 * closed tab), it leaves, so an empty room spends no more of the person's day.
 */
export const PERSON_JOIN_WAIT_MS = 60_000;

/** One turn's step times, each from the person's end of speech (§9.3). */
interface TurnTimes {
  speechEndAt?: number;
  finalAt?: number;
  firstSentenceAt?: number;
  firstChunkAt?: number;
}

/** 16-bit samples as the bytes a speech stream takes (little-endian). */
function pcmBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(i * 2, samples[i] ?? 0, true);
  return bytes;
}

export class VoiceSession {
  private ended = false;
  private endedWith: EndReason | undefined;
  private finished: Promise<void>;
  private finish: () => void = () => undefined;
  private startedAt = 0;
  private hardEnd: unknown;
  /** The wait for the person to join, while it runs. */
  private joinWait: unknown;
  private stt: SttStream | undefined;
  /** True once speech-to-text has failed: push-to-talk and typed questions from then on. */
  private fallback = false;
  private held = false;
  private ttsStream: TtsStream | undefined;
  private ttsDown = false;
  private turn: AbortController | undefined;
  private speech: Promise<void> = Promise.resolve();
  private speaking = false;
  private state: VoiceState | undefined;
  /** Sentences waiting to be spoken or being spoken. */
  private queued = 0;
  private readonly spend: SpendMeter;
  private readonly steps = new Map<VoiceTurnStep, number[]>();
  private turns = 0;
  private bargeIns = 0;
  private audioFileId: string | undefined;

  constructor(private readonly deps: SessionDeps) {
    this.spend = new SpendMeter(deps.metadata.model);
    this.finished = new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  /** How often the person spoke over Shakti, for the tests and the logs. */
  get interruptions(): number {
    return this.bargeIns;
  }

  get endReason(): EndReason | undefined {
    return this.endedWith;
  }

  /** Runs the session until it ends; resolves then. */
  async run(): Promise<void> {
    const { room, metadata, clock, timers } = this.deps;
    this.startedAt = clock.now();
    const untilNotAfter = Date.parse(metadata.notAfter) - this.deps.wallNow();
    // Ends a little before `notAfter`, so the recording is still filed while the session is live.
    const longest = Math.min(
      untilNotAfter - END_MARGIN_MS,
      metadata.limits.maxSessionMinutes * 60_000,
    );
    this.hardEnd = timers.set(
      () => {
        void this.end('time_up');
      },
      Math.max(0, longest),
    );
    room.onPageMessage((message) => {
      void this.onPage(message);
    });
    room.onPersonLeft(() => {
      void this.end('ended');
    });
    // Nothing is said or heard until the person is in the room.
    const joined = await Promise.race([this.personJoined(), this.finished.then(() => false)]);
    if (!joined || this.ended) {
      await this.end('ended');
      return;
    }
    void this.pumpAudio();
    await this.setState('listening');
    await this.sendMinutes();
    this.say(metadata.mode === 'teach' ? 'voice_greeting_teach' : 'voice_greeting_ask');
    if (this.deps.stt === undefined) await this.fallBack();
    else void this.listen();
    await this.finished;
  }

  /** Whether the person joined within `PERSON_JOIN_WAIT_MS`; false when they did not. */
  private personJoined(): Promise<boolean> {
    return new Promise((resolve) => {
      // The room may call back at once (the person is already there), before the wait is set.
      const wait = { settled: false };
      const settle = (joined: boolean) => {
        if (wait.settled) return;
        wait.settled = true;
        this.clearJoinWait();
        resolve(joined);
      };
      this.deps.room.onPersonJoined(() => {
        settle(true);
      });
      if (wait.settled) return;
      this.joinWait = this.deps.timers.set(() => {
        settle(false);
      }, PERSON_JOIN_WAIT_MS);
    });
  }

  private clearJoinWait(): void {
    if (this.joinWait === undefined) return;
    this.deps.timers.clear(this.joinWait);
    this.joinWait = undefined;
  }

  private async setState(state: VoiceState): Promise<void> {
    if (this.ended || this.state === state) return;
    this.state = state;
    await this.deps.room.send({ type: 'state', state });
  }

  private elapsed(): number {
    return this.deps.clock.now() - this.startedAt;
  }

  private async sendMinutes(): Promise<void> {
    const left = this.deps.metadata.limits.maxSessionMinutes - Math.ceil(this.elapsed() / 60_000);
    await this.deps.room.send({ type: 'minutes', minutesLeft: Math.max(0, left) });
  }

  /** The person's audio: to the recording, and to speech-to-text while a stream is open. */
  private async pumpAudio(): Promise<void> {
    for await (const frame of this.deps.room.audioIn) {
      if (this.ended) break;
      this.deps.recorder?.add(frame);
      this.stt?.send(pcmBytes(frame));
    }
  }

  private async openStt(): Promise<SttStream | undefined> {
    const stt = this.deps.stt;
    if (stt === undefined) return undefined;
    try {
      return await stt.open({
        languageCode: this.deps.languageCode,
        sampleRate: AUDIO_IN_SAMPLE_RATE,
      });
    } catch (error) {
      this.deps.log?.('voice.stt_open_failed', { error: String(error) });
      return undefined;
    }
  }

  /** Listens continuously; a failure of the speech service falls back to push-to-talk. */
  private async listen(): Promise<void> {
    while (!this.ended && !this.fallback) {
      const stream = await this.openStt();
      if (stream === undefined) {
        await this.fallBack();
        return;
      }
      this.stt = stream;
      try {
        await this.readEvents(stream);
      } catch (error) {
        this.deps.log?.('voice.stt_failed', { error: String(error) });
        this.stt = undefined;
        await this.fallBack();
        return;
      }
      this.stt = undefined;
    }
  }

  private async readEvents(stream: SttStream): Promise<void> {
    let times: TurnTimes = {};
    for await (const event of stream.events) {
      if (this.ended) return;
      if (event.type === 'speech_start') {
        // The person spoke over Shakti: stop at once.
        if (this.speaking || this.turn !== undefined) this.bargeIn();
        times = {};
      } else if (event.type === 'speech_end') {
        times.speechEndAt = event.atMs;
      } else if (event.type === 'final') {
        const text = event.text.trim();
        if (text !== '') void this.handleTurn(text, { ...times, finalAt: event.atMs });
        times = {};
      }
    }
  }

  private async fallBack(): Promise<void> {
    if (this.fallback || this.ended) return;
    this.fallback = true;
    await this.setState('push_to_talk');
    this.say('voice_network_weak');
  }

  private async onPage(message: VoicePageMessage): Promise<void> {
    if (this.ended) return;
    if (message.type === 'text') {
      await this.handleTurn(message.text, {});
      return;
    }
    if (message.type === 'make_drafts') {
      await this.makeDrafts();
      return;
    }
    // Push-to-talk: a stream while the button is held, settled when it is let go.
    if (message.held && !this.held) {
      this.held = true;
      if (this.speaking || this.turn !== undefined) this.bargeIn();
      if (this.stt === undefined) {
        const stream = await this.openStt();
        if (stream === undefined) return;
        this.stt = stream;
        void this.readEvents(stream)
          .catch((error: unknown) => {
            this.deps.log?.('voice.ptt_failed', { error: String(error) });
          })
          .finally(() => {
            if (this.stt === stream) this.stt = undefined;
          });
      }
    } else if (!message.held && this.held) {
      this.held = false;
      if (this.fallback) this.stt?.end();
    }
  }

  /** Stops Shakti's reply and speech at once. */
  private bargeIn(): void {
    this.bargeIns += 1;
    this.turn?.abort();
    this.turn = undefined;
    this.deps.room.stopSpeech();
    this.speaking = false;
  }

  private async tts(): Promise<TtsStream | undefined> {
    if (this.ttsStream !== undefined || this.ttsDown || this.deps.tts === undefined) {
      return this.ttsStream;
    }
    try {
      this.ttsStream = await this.deps.tts.open({ languageCode: this.deps.languageCode });
    } catch (error) {
      this.deps.log?.('voice.tts_open_failed', { error: String(error) });
      this.ttsDown = true;
    }
    return this.ttsStream;
  }

  /** Whether a turn was stopped or the session ended, read afresh after every wait. */
  private stopped(signal: AbortSignal): boolean {
    return signal.aborted || this.ended;
  }

  /** Captions a sentence and speaks it, unless the turn was stopped first. */
  private async speak(sentence: string, signal: AbortSignal, times?: TurnTimes): Promise<void> {
    if (signal.aborted || this.ended) return;
    await this.deps.room.send({ type: 'caption', speaker: 'shakti', text: sentence, final: true });
    const stream = await this.tts();
    if (stream === undefined) return;
    try {
      for await (const chunk of stream.speak(sentence)) {
        if (this.stopped(signal)) return;
        if (times !== undefined) times.firstChunkAt ??= chunk.atMs;
        if (!this.speaking) {
          this.speaking = true;
          await this.setState('speaking');
        }
        await this.deps.room.play(chunk);
      }
    } catch (error) {
      // Speech failed: the captions carry the rest of the session.
      this.deps.log?.('voice.tts_failed', { error: String(error) });
      this.ttsDown = true;
      this.ttsStream?.close();
      this.ttsStream = undefined;
    }
  }

  /**
   * Speaks after whatever is being said. Once nothing is left to say and no turn is open, the
   * light goes back to listening, so the person speaking next is not taken for an interruption.
   */
  private enqueue(sentence: string, signal: AbortSignal, times?: TurnTimes): void {
    this.queued += 1;
    this.speech = this.speech
      .then(() => this.speak(sentence, signal, times))
      .finally(async () => {
        this.queued -= 1;
        if (this.queued === 0 && this.turn === undefined && !this.ended) {
          this.speaking = false;
          await this.setState(this.fallback ? 'push_to_talk' : 'listening');
        }
      });
  }

  /** A line of Shakti's own, spoken after whatever is being said. */
  private say(name: TalkPromptName): void {
    this.enqueue(said(name), new AbortController().signal);
  }

  private async handleTurn(text: string, times: TurnTimes): Promise<void> {
    if (this.ended) return;
    if (this.turn !== undefined || this.speaking) this.bargeIn();
    const controller = new AbortController();
    this.turn = controller;
    const { signal } = controller;
    await this.deps.room.send({ type: 'caption', speaker: 'person', text, final: true });
    await this.setState('thinking');
    try {
      const answer = await this.deps.responder.respond(text, {
        signal,
        onSentence: (sentence) => {
          if (signal.aborted) return;
          times.firstSentenceAt ??= this.deps.clock.now();
          this.enqueue(sentence, signal, times);
        },
      });
      if (answer.usage !== undefined) this.spend.addReply(answer.usage);
      if (answer.cards !== undefined && answer.cards.length > 0 && !signal.aborted) {
        await this.deps.room.send({ type: 'cards', cards: answer.cards });
      }
      await this.speech;
    } catch (error) {
      if (signal.aborted) return;
      this.deps.log?.('voice.turn_failed', { error: String(error) });
      this.say('voice_answer_failed');
      await this.speech;
    }
    if (signal.aborted) return;
    this.turn = undefined;
    this.speaking = false;
    this.record(times);
    await this.setState(this.fallback ? 'push_to_talk' : 'listening');
    await this.sendMinutes();
    await this.deps.room.report(this.report());
    if (this.spend.paise(this.elapsed()) >= this.deps.metadata.limits.paiseRemainingToday) {
      await this.end('day_limit');
    }
  }

  private async makeDrafts(): Promise<void> {
    const make = this.deps.responder.makeDrafts?.bind(this.deps.responder);
    if (make === undefined || this.ended) return;
    if (this.turn !== undefined || this.speaking) this.bargeIn();
    const controller = new AbortController();
    this.turn = controller;
    await this.setState('thinking');
    try {
      const { drafts, usage } = await make(controller.signal);
      if (usage !== undefined) this.spend.addReply(usage);
      for (const draft of drafts) await this.deps.room.send({ type: 'draft', draft });
      this.say(drafts.length > 0 ? 'voice_drafts_ready' : 'voice_drafts_failed');
    } catch (error) {
      if (controller.signal.aborted) return;
      this.deps.log?.('voice.drafts_failed', { error: String(error) });
      this.say('voice_drafts_failed');
    }
    await this.speech;
    if (this.turn === controller) this.turn = undefined;
    await this.setState(this.fallback ? 'push_to_talk' : 'listening');
  }

  /** A completed turn's step times, each counted only when both its ends were seen. */
  private record(times: TurnTimes): void {
    this.turns += 1;
    const add = (step: VoiceTurnStep, from: number | undefined, to: number | undefined) => {
      if (from === undefined || to === undefined) return;
      const list = this.steps.get(step) ?? [];
      list.push(Math.max(0, Math.round(to - from)));
      this.steps.set(step, list);
    };
    add('final_transcript', times.speechEndAt, times.finalAt);
    add('first_sentence', times.finalAt, times.firstSentenceAt);
    add('first_speech', times.firstSentenceAt, times.firstChunkAt);
    add('first_audio', times.speechEndAt, times.firstChunkAt);
  }

  /** The turns and each step's p50 and p95, as `voice_sessions.turn_stats_json` keeps them. */
  turnStats(): VoiceTurnStats {
    const steps: VoiceTurnStats['steps'] = {};
    for (const [step, values] of this.steps) {
      steps[step] = { p50Ms: percentile(values, 50), p95Ms: percentile(values, 95) };
    }
    return { turns: this.turns, steps };
  }

  private report() {
    return {
      costPaise: this.spend.paise(this.elapsed()),
      turnStats: this.turnStats(),
      ...(this.audioFileId === undefined ? {} : { audioFileId: this.audioFileId }),
    };
  }

  /** Ends the session once: says why when it is a limit, files a recording, reports, leaves. */
  async end(reason: EndReason): Promise<void> {
    if (this.ended) return;
    if (reason === 'time_up' || reason === 'day_limit') {
      this.turn?.abort();
      this.deps.room.stopSpeech();
      this.speech = Promise.resolve();
      this.say(reason === 'time_up' ? 'voice_time_up' : 'voice_day_limit');
      await this.speech;
    }
    this.ended = true;
    this.endedWith = reason;
    this.deps.timers.clear(this.hardEnd);
    this.clearJoinWait();
    this.turn?.abort();
    this.stt?.close();
    this.ttsStream?.close();
    const { room, bos, recorder } = this.deps;
    await room.send({ type: 'ended', reason });
    if (recorder !== undefined && !recorder.empty) {
      try {
        const kept = await bos.uploadRecording(recorder.wav());
        if (kept.linked) this.audioFileId = kept.fileId;
      } catch (error) {
        this.deps.log?.('voice.recording_failed', { error: String(error) });
      }
    }
    await room.report(this.report());
    bos.stop();
    await room.leave();
    this.finish();
  }
}
