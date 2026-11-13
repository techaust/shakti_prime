import { AGENT_DEFAULTS } from '@shakti/domain';
import { asArray, asObject, asString } from '../../http';
import { claudeReplyModel, type ClaudeConfig } from '../claude-stream';
import { replayFetch, replaySockets, ReplayClock, type RecordedSession } from '../recorded';
import { sarvamConfig, sarvamStreamingStt, sarvamStreamingTts } from '../sarvam';
import type { ListenerMark, SpeechPrice } from './measures';
import { observeTurn, scoreBenchmark, type BenchmarkReport, type TurnObservation } from './run';
import type { StandInSet } from './stand-in-set';

/**
 * The benchmark on recorded sessions: every turn runs through the real Sarvam and Claude adapters
 * with a replayed socket, a replayed stream and a clock the replay moves, so the numbers come out
 * the same on every run and in CI, with no key and no vendor call.
 */

/** One turn's three recorded sessions, as `--save-replay` writes them (`<item id>.json`). */
export interface RecordedTurn {
  speechToText: RecordedSession;
  reply: RecordedSession;
  speech: RecordedSession;
}

function session(value: unknown, where: string): RecordedSession {
  const raw = asObject(value);
  const source = raw?.source;
  if (raw === undefined || (source !== 'written' && source !== 'recorded')) {
    throw new Error(`${where}: a session with source written or recorded is expected`);
  }
  const frames = asArray(raw.frames).map((frame, i) => {
    const f = asObject(frame);
    const atMs = f?.atMs;
    if (f === undefined || typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs < 0) {
      throw new Error(`${where}.frames[${String(i)}]: a frame with atMs is expected`);
    }
    const text = asString(f.text);
    return text === undefined ? { atMs, data: f.data } : { atMs, text };
  });
  return { source, note: asString(raw.note) ?? '', frames };
}

/** Reads a recorded turn; throws naming the session that is wrong. */
export function parseRecordedTurn(json: unknown, where: string): RecordedTurn {
  const raw = asObject(json);
  return {
    speechToText: session(raw?.speechToText, `${where}.speechToText`),
    reply: session(raw?.reply, `${where}.reply`),
    speech: session(raw?.speech, `${where}.speech`),
  };
}

/** The replay's stand-in key: a phrase, never sent anywhere. */
const REPLAY_KEY = 'replayed session key';
const SAMPLE_RATE = 16_000;
const CHUNK_MS = 100;

export async function replayBenchmark(input: {
  set: StandInSet;
  turns: ReadonlyMap<string, RecordedTurn>;
  marks: readonly ListenerMark[];
  speechPrice: SpeechPrice;
}): Promise<BenchmarkReport> {
  const sarvam = sarvamConfig({ SARVAM_API_KEY: REPLAY_KEY });
  if (sarvam === undefined) throw new Error('the replay needs a Sarvam configuration');
  const claude: ClaudeConfig = {
    apiKey: REPLAY_KEY,
    model: AGENT_DEFAULTS.voice.model,
    effort: AGENT_DEFAULTS.voice.effort,
    thinking: AGENT_DEFAULTS.voice.thinking,
    maxTokens: AGENT_DEFAULTS.voice.maxTokens,
    baseUrl: 'https://api.anthropic.com',
  };
  const clock = new ReplayClock();
  const observations: TurnObservation[] = [];
  const durationsMs = new Map<string, number>();
  for (const item of input.set.items) {
    const turn = input.turns.get(item.id);
    if (turn === undefined) throw new Error(`no recorded turn for ${item.id}`);
    if (item.durationMs === undefined || item.speechEndMs === undefined) {
      throw new Error(`${item.id}: a replay needs durationMs and speechEndMs in the set`);
    }
    durationsMs.set(item.id, item.durationMs);
    const sockets = replaySockets([turn.speechToText, turn.speech], clock);
    const stream = replayFetch([turn.reply], clock);
    // Silence of the recording's length stands for its audio: the recorded session answers.
    const bytesPerChunk = (SAMPLE_RATE * CHUNK_MS * 2) / 1000;
    const chunks = Array.from(
      { length: Math.ceil(item.durationMs / CHUNK_MS) },
      () => new Uint8Array(bytesPerChunk),
    );
    observations.push(
      await observeTurn(
        item,
        {
          sampleRate: SAMPLE_RATE,
          chunks,
          chunkMs: CHUNK_MS,
          durationMs: item.durationMs,
          speechEndMs: item.speechEndMs,
        },
        {
          stt: sarvamStreamingStt(sarvam, { openSocket: sockets.open, clock }),
          tts: sarvamStreamingTts(sarvam, { openSocket: sockets.open, clock }),
          llm: claudeReplyModel(claude, { fetch: stream.fetch, timeoutMs: 1_000 }, clock),
          clock,
        },
        { languageCode: input.set.languageCode, pace: () => Promise.resolve() },
      ),
    );
  }
  return scoreBenchmark({
    set: input.set,
    observations,
    durationsMs,
    marks: input.marks,
    vendors: {
      speechToText: `sarvam ${sarvam.sttModel} ${sarvam.sttMode} (replayed)`,
      reply: `anthropic ${claude.model} (replayed)`,
      speech: `sarvam ${sarvam.ttsModel} (replayed)`,
    },
    speechPrice: input.speechPrice,
    replyModel: claude.model,
  });
}
