import { AGENT_DEFAULTS } from '../agent-defaults';
import type { AiProvider, SpendCap } from '../provider';
import type { TriageFacts } from './facts';
import { filterTriageAnswer, type TriageVerdicts } from './filter';
import { buildTriagePrompt } from './prompt';

/** The purpose an eval run's calls are counted under, apart from the agent's own runs. */
export const TRIAGE_EVAL_PURPOSE = 'triage_eval';

/**
 * One case of the eval or injection set: the prompt the facts make, sent through the provider
 * wrapper (masked and labelled as in a real run) and the filter's verdict on the answer. The same
 * path as `runTriage()` between the facts and the record; CI runs it on the fake transport with
 * the recorded answers, and `eval:triage` on the live model.
 */
export async function evaluateTriage(
  provider: AiProvider,
  facts: TriageFacts,
  caps: readonly SpendCap[],
): Promise<{ text: string; verdicts: TriageVerdicts }> {
  const prompt = buildTriagePrompt(facts);
  const reply = await provider.complete({
    agent: 'agent:triage',
    purpose: TRIAGE_EVAL_PURPOSE,
    entityId: facts.entityId,
    caps,
    system: prompt.system,
    question: prompt.question,
    untrusted: prompt.untrusted,
    maxTokens: prompt.maxTokens,
    totalTimeoutMs: AGENT_DEFAULTS.triage.totalTimeoutMs,
  });
  return { text: reply.text, verdicts: filterTriageAnswer(reply.text, facts) };
}
