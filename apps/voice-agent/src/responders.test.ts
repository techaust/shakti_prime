import { verhoeffCheckDigit } from '@shakti/contracts/masking';
import type { Reply, ReplyModel, ReplyOptions } from '@shakti/voice';
import { describe, expect, it } from 'vitest';
import { teachResponder } from './responders';

// Teach's model calls (SECURITY §3.4, BLUEPRINT §9.2): the person's speech, as speech-to-text
// wrote it, is masked before it reaches the model, in every turn and in the drafting transcript.
// The model is a stand-in that keeps what it was sent; no vendor is reached.

/** A Verhoeff-valid Aadhaar number, read out in its usual groups of four. */
const AADHAAR_BODY = '23456789012';
const AADHAAR = `${AADHAAR_BODY}${verhoeffCheckDigit(AADHAAR_BODY)}`;
const AADHAAR_SPOKEN = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;
const ACCOUNT = '50100234567891';
const PHONE = '9876543210';

/** A reply model that answers one fixed line and keeps every call it was given. */
function keepingModel() {
  const calls: { system: string; text: string; history: string[] }[] = [];
  const model: ReplyModel = {
    vendor: 'fake',
    model: 'claude-sonnet-5-5',
    reply(system: string, text: string, options?: ReplyOptions): Promise<Reply> {
      calls.push({ system, text, history: (options?.history ?? []).map((t) => t.text) });
      const answer = text.startsWith('[') ? '[]' : 'Theek hai, aur kuch?';
      options?.onSentence?.(answer);
      return Promise.resolve({
        text: answer,
        firstTokenMs: 1,
        firstSentenceMs: 1,
        firstSentence: answer,
        totalMs: 1,
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      });
    },
  };
  return { model, calls };
}

const turn = () => ({ signal: new AbortController().signal, onSentence: () => undefined });

/** Every text a model call carried: the turn, the history and the drafting transcript. */
const everything = (calls: ReturnType<typeof keepingModel>['calls']) =>
  calls.flatMap((c) => [c.text, ...c.history]).join('\n');

describe('a Teach interview', () => {
  it('masks identity numbers and phones before every model call, in turns and drafts', async () => {
    const interview = keepingModel();
    const drafting = keepingModel();
    const teach = teachResponder(interview.model, drafting.model);
    await teach.respond(`Customer ka aadhaar ${AADHAAR_SPOKEN} hai, usse KYC lena.`, turn());
    await teach.respond(
      `Refund account number ${ACCOUNT} mein jayega, phone ${PHONE} pe batana.`,
      turn(),
    );
    await teach.makeDrafts?.(new AbortController().signal);

    const sent = everything(interview.calls);
    const drafted = everything(drafting.calls);
    expect(interview.calls).toHaveLength(2);
    expect(drafting.calls).toHaveLength(1);
    for (const text of [sent, drafted]) {
      expect(text.replace(/\D/g, '')).not.toContain(AADHAAR);
      expect(text).not.toContain(AADHAAR_SPOKEN);
      expect(text).not.toContain(ACCOUNT);
      expect(text).not.toContain(PHONE);
      expect(text).toContain('[number]');
      expect(text).toContain('[phone]');
    }
    // The words around the numbers still reach the model: the rule is kept, the numbers are not.
    expect(interview.calls[0]?.text).toContain('usse KYC lena');
    // The second turn reads the first one masked, as it was sent.
    expect(interview.calls[1]?.history[0]).toBe(interview.calls[0]?.text);
  });
});
