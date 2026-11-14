import { NO_USAGE } from '../models';
import type { ModelReply, ModelRequest, ModelTransport } from '../transport';
import { ASK_SYSTEM } from './prompt';

// Ask the Business on recorded answers (docs/03-roadmap-appendix/phase2.md §14): the model's part
// of a question written down beforehand, as the lookups it asks for and an answer written from
// what they return, so the eval set runs in CI and the journeys run on a machine without a model
// key, with no model and every lookup, the filter and the records real. Never on a hosted runtime.

/** What the lookups returned, by lookup name, each answer as the model would read it. */
export type LookupResults = Readonly<Record<string, readonly Record<string, unknown>[]>>;

/** The model's part of one question: the lookups it asks for, then its answer from their data. */
export interface AskRecording {
  lookups: readonly { name: string; input: Record<string, unknown> }[];
  answer: (results: LookupResults, question: string) => string;
}

/** A lookup's answer as the wrapper sent it: the data between its labels, read back as JSON. */
function readResult(content: string): Record<string, unknown> | undefined {
  const start = content.indexOf('\n');
  const end = content.lastIndexOf('\n</untrusted_data>');
  if (start < 0 || end <= start) return undefined;
  const json = content
    .slice(start + 1, end)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

const reply = (text: string, extra: Partial<ModelReply> = {}): ModelReply => ({
  text,
  usage: { ...NO_USAGE, inputTokens: 200, outputTokens: 40 },
  stopped: 'finished',
  ...extra,
});

/** The person's question as the wrapper sent it (`askQuestion()`'s last line). */
function questionOf(request: ModelRequest): string {
  const marker = 'The question: ';
  const at = request.user.lastIndexOf(marker);
  return at < 0 ? request.user : request.user.slice(at + marker.length);
}

/**
 * A transport that plays `pick(question)`'s recording for Ask's requests: its lookups first, then
 * its answer from what they returned. Any other request goes to `otherwise`.
 */
export function recordedAskTransport(
  pick: (question: string) => AskRecording,
  otherwise?: ModelTransport,
): ModelTransport {
  return {
    complete(request, signal) {
      if (request.system !== ASK_SYSTEM) {
        return otherwise === undefined
          ? Promise.resolve(reply(''))
          : otherwise.complete(request, signal);
      }
      const recording = pick(questionOf(request));
      const rounds = request.rounds ?? [];
      if (rounds.length === 0 && recording.lookups.length > 0) {
        const toolCalls = recording.lookups.map((l, i) => ({
          id: `recorded-${String(i + 1)}`,
          name: l.name,
          input: l.input,
        }));
        return Promise.resolve(reply('', { toolCalls, assistant: toolCalls }));
      }
      const results: Record<string, Record<string, unknown>[]> = {};
      for (const round of rounds) {
        const calls = (Array.isArray(round.assistant) ? round.assistant : []) as {
          id?: unknown;
          name?: unknown;
        }[];
        for (const r of round.results) {
          const name = calls.find((c) => c.id === r.callId)?.name;
          const data = r.isError === true ? undefined : readResult(r.content);
          if (typeof name !== 'string' || data === undefined) continue;
          (results[name] ??= []).push(data);
        }
      }
      return Promise.resolve(reply(recording.answer(results, questionOf(request))));
    },
  };
}

/** The first record of a lookup's list, if any. */
export function firstRecord(
  results: LookupResults,
  lookup: string,
  list: string,
): Record<string, unknown> | undefined {
  const rows = results[lookup]?.[0]?.[list];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[])[0] : undefined;
}

/**
 * The recording the journeys and a developer's machine use (`AI_TRANSPORT=fake`): the open leads
 * of the first pipeline stage that has any, cited.
 */
export const STAND_IN_ASK: AskRecording = {
  lookups: [{ name: 'pipeline_by_stage', input: {} }],
  answer(results) {
    const rows = (results.pipeline_by_stage?.[0]?.stages ?? []) as Record<string, unknown>[];
    const stage = rows.find((r) => typeof r.openLeads === 'number' && r.openLeads > 0);
    if (stage === undefined) return 'None of the leads you can see is open right now.';
    return `The stage ${String(stage.stage)} of ${String(stage.company)} has ${String(stage.openLeads)} open leads [ref:${String(stage.ref)}].`;
  },
};
