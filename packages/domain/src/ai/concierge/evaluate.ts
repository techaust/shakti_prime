import { AGENT_DEFAULTS } from '../agent-defaults';
import type { AiProvider, SpendCap } from '../provider';
import { conciergeFilterFacts, type ConciergeRunFacts } from './facts';
import { filterConciergeAnswer, type ConciergeVerdicts } from './filter';
import { buildConciergePrompt } from './prompt';
import { handoffRuleOf, type ConciergeRuleCause } from './rules';

/** The purpose an eval run's calls are counted under, apart from the agent's own runs. */
export const CONCIERGE_EVAL_PURPOSE = 'concierge_eval';

/** One case's result: the rule that handed the chat over first, or the model's text and verdicts. */
export type ConciergeEvaluation =
  | { rule: ConciergeRuleCause; text?: undefined; verdicts?: undefined }
  | { rule: null; text: string; verdicts: ConciergeVerdicts };

/**
 * One case of the Concierge's eval or injection set: the hand-off rules on the customer's newest
 * words, then the prompt the facts make, sent through the provider wrapper (masked and labelled as
 * in a real run) and the filter's verdict on the answer. The same path as `runConcierge()` between
 * the facts and the record; CI runs it on the fake transport with the recorded answers, and
 * `eval:concierge` on the live model.
 */
export async function evaluateConcierge(
  provider: AiProvider,
  facts: ConciergeRunFacts,
  caps: readonly SpendCap[],
): Promise<ConciergeEvaluation> {
  const answering = facts.messages.filter((m) => m.direction === 'inbound').at(-1)?.text ?? null;
  const rule = handoffRuleOf(answering);
  if (rule !== null) return { rule };
  const prompt = buildConciergePrompt(facts);
  const reply = await provider.complete({
    agent: 'agent:concierge',
    purpose: CONCIERGE_EVAL_PURPOSE,
    entityId: facts.entityId,
    caps,
    model: prompt.model,
    effort: prompt.effort,
    system: prompt.system,
    question: prompt.question,
    untrusted: prompt.untrusted,
    maxTokens: prompt.maxTokens,
    totalTimeoutMs: AGENT_DEFAULTS.concierge.totalTimeoutMs,
  });
  return {
    rule: null,
    text: reply.text,
    verdicts: filterConciergeAnswer(reply.text, conciergeFilterFacts(facts)),
  };
}
