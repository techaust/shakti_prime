import { newId, VoiceDraft, type AskSourceLabelDto } from '@shakti/contracts';
import { completeSentences, type ReplyModel, type ReplyTurn } from '@shakti/voice';
import type { SpokenAnswer } from './bos-client';
import { DRAFT_SYSTEM, TEACH_SYSTEM } from './prompts';
import type { Responder } from './session';

/** The most sentences of an Ask answer spoken aloud; the cited cards show the rest of it. */
export const SPOKEN_ANSWER_SENTENCES = 2;

/** An answer's text as it is spoken: without the citation marks the cards stand for. */
export function spokenText(answer: string): string {
  return answer
    .replace(/\[ref:[^\]]*\]/g, '')
    .replace(/\s+([.,?!])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Ask (docs/03-roadmap-appendix/phase2.md §7.5): B1's service through `POST /api/v1/ask` as the
 * person, a short spoken answer (its first two sentences) and the cited records on the screen. No
 * model runs in the worker for Ask: B1's runs on the BOS under the person's grants and caps.
 */
export function askResponder(
  ask: (question: string, signal: AbortSignal) => Promise<SpokenAnswer>,
): Responder {
  return {
    async respond(text, turn) {
      const answer = await ask(text, turn.signal);
      const words = spokenText(answer.text);
      const { sentences, end } = completeSentences(`${words} `, 0);
      const spoken = sentences.length > 0 ? sentences : [words.slice(end).trim()];
      for (const sentence of spoken.slice(0, SPOKEN_ANSWER_SENTENCES)) {
        if (sentence !== '') turn.onSentence(sentence);
      }
      const cards: AskSourceLabelDto[] = answer.sources;
      return { cards };
    },
  };
}

/** The most earlier turns a Teach reply reads: the interview, kept short. */
export const TEACH_HISTORY_TURNS = 24;

/** The JSON array a drafting reply answers with, as directives the person may save. */
export function parseDrafts(text: string): VoiceDraft[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end < start) return [];
  let items: unknown;
  try {
    items = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  return items
    .slice(0, 5)
    .map((item: unknown) =>
      VoiceDraft.safeParse({
        ...(typeof item === 'object' && item !== null ? item : {}),
        id: newId(),
      }),
    )
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
}

/**
 * Teach: an interview by the model, one short question at a time, keeping the conversation; on
 * the person's tap, the interview drafted as directives the person saves on the screen through
 * `knowledge.playbook.draft` under their own sign-in (never by the worker).
 */
export function teachResponder(model: ReplyModel, drafter: ReplyModel = model): Responder {
  const history: ReplyTurn[] = [];
  return {
    async respond(text, turn) {
      const reply = await model.reply(TEACH_SYSTEM, text, {
        history: history.slice(-TEACH_HISTORY_TURNS),
        onSentence: turn.onSentence,
        signal: turn.signal,
      });
      history.push({ role: 'user', text }, { role: 'assistant', text: reply.text });
      return { usage: reply.usage };
    },
    async makeDrafts(signal) {
      if (history.length === 0) return { drafts: [] };
      const transcript = history
        .map((t) => `${t.role === 'user' ? 'Person' : 'Shakti'}: ${t.text}`)
        .join('\n');
      const reply = await drafter.reply(DRAFT_SYSTEM, transcript, { signal });
      return { drafts: parseDrafts(reply.text), usage: reply.usage };
    },
  };
}
