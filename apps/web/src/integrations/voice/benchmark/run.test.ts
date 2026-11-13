import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../http';
import type {
  Reply,
  ReplyModel,
  SpeechChunk,
  StreamingSpeechToText,
  StreamingTextToSpeech,
  SttEvent,
} from '../ports';
import { observeTurn, type Pace, type TurnAudio } from './run';
import type { SetItem } from './stand-in-set';

const ITEM: SetItem = {
  id: 'q01',
  file: 'q01.wav',
  language: 'hinglish',
  speaker: 'team-1',
  reference: 'paanch HP ka pump stock mein hai kya',
  keyTerms: [],
};

/** Five 100 ms chunks; the speaker stops at 250 ms, inside the third. */
const AUDIO: TurnAudio = {
  sampleRate: 16_000,
  chunks: Array.from({ length: 5 }, () => new Uint8Array(2)),
  chunkMs: 100,
  durationMs: 500,
  speechEndMs: 250,
};

const USAGE = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** A recogniser that answers once the audio has ended, with the events given. */
function recogniser(events: SttEvent[]): StreamingSpeechToText {
  return {
    vendor: 'fake',
    open: () => {
      let ended: () => void = () => undefined;
      const done = new Promise<void>((resolve) => {
        ended = resolve;
      });
      async function* stream(): AsyncGenerator<SttEvent> {
        await done;
        yield* events;
      }
      return Promise.resolve({
        send: () => undefined,
        end: () => {
          ended();
        },
        close: () => undefined,
        events: stream(),
      });
    },
  };
}

const HEARD: SttEvent[] = [
  { type: 'speech_end', atMs: 540 },
  { type: 'final', text: 'panch HP ka pump stock me hai kya', languageCode: 'hi-IN', atMs: 700 },
];

function model(answer: () => Promise<Reply>): ReplyModel {
  return { vendor: 'fake', model: 'claude-sonnet-5-5', reply: answer };
}

const REPLY: Reply = {
  text: 'Ji, stock mein hai. Kal aayega.',
  firstTokenMs: 200,
  firstSentenceMs: 400,
  firstSentence: 'Ji, stock mein hai.',
  totalMs: 600,
  usage: USAGE,
};

function speaker(open: StreamingTextToSpeech['open']): StreamingTextToSpeech {
  return { vendor: 'fake', open };
}

const SPEAKS = speaker(() =>
  Promise.resolve({
    async *speak(): AsyncGenerator<SpeechChunk> {
      await Promise.resolve();
      yield { audio: new Uint8Array(1), mimeType: 'audio/L16;rate=16000', atMs: 0 };
    },
    close: () => undefined,
  }),
);

const clock = { now: () => 0 };
const onTime: Pace = (atMs) => Promise.resolve(atMs);

describe('one benchmark turn', () => {
  it('paces chunks to absolute times and leaves the stop chunk’s lateness out', async () => {
    const asked: number[] = [];
    // The chunk holding the stop (due at 300 ms) goes out 40 ms late; the others on time.
    const late: Pace = (atMs) => {
      asked.push(atMs);
      return Promise.resolve(atMs === 300 ? 340 : atMs);
    };
    const turn = await observeTurn(
      ITEM,
      AUDIO,
      { stt: recogniser(HEARD), llm: model(() => Promise.resolve(REPLY)), tts: SPEAKS, clock },
      { languageCode: 'hi-IN', pace: late },
    );
    expect(asked).toEqual([100, 200, 300, 400, 500]);
    // The stop counts from 340 - 50 = 290 ms, not 250: the recogniser's 250 ms is its own.
    expect(turn.timing).toMatchObject({ endOfSpeechMs: 250, finalTranscriptMs: 160 });
    expect(turn.failure).toBeUndefined();
  });

  it('keeps the transcript when the reply fails, and names the step', async () => {
    const turn = await observeTurn(
      ITEM,
      AUDIO,
      {
        stt: recogniser(HEARD),
        llm: model(() =>
          Promise.reject(
            new ProviderError('anthropic', 'invalid_response', { vendorCode: 'refusal' }),
          ),
        ),
        tts: SPEAKS,
        clock,
      },
      { languageCode: 'hi-IN', pace: onTime },
    );
    expect(turn).toEqual({
      id: 'q01',
      transcript: 'panch HP ka pump stock me hai kya',
      replyCharacters: 0,
      failure: 'reply: anthropic invalid_response refusal',
    });
  });

  it('keeps the transcript and the reply’s tokens when the speech fails', async () => {
    const turn = await observeTurn(
      ITEM,
      AUDIO,
      {
        stt: recogniser(HEARD),
        llm: model(() => Promise.resolve(REPLY)),
        tts: speaker(() => Promise.reject(new ProviderError('sarvam', 'timeout'))),
        clock,
      },
      { languageCode: 'hi-IN', pace: onTime },
    );
    expect(turn).toMatchObject({
      transcript: 'panch HP ka pump stock me hai kya',
      replyCharacters: REPLY.text.length,
      usage: USAGE,
      failure: 'speech: sarvam timeout',
    });
    expect(turn.timing).toBeUndefined();
  });

  it('records any other error as unexpected, without its message', async () => {
    const turn = await observeTurn(
      ITEM,
      AUDIO,
      {
        stt: {
          vendor: 'fake',
          open: () => Promise.reject(new Error('paanch HP ka pump')),
        },
        llm: model(() => Promise.resolve(REPLY)),
        tts: SPEAKS,
        clock,
      },
      { languageCode: 'hi-IN', pace: onTime },
    );
    expect(turn).toEqual({
      id: 'q01',
      transcript: '',
      replyCharacters: 0,
      failure: 'speech to text: unexpected',
    });
  });
});
