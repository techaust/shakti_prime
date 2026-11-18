import { AGENT_DEFAULTS } from '../agent-defaults';
import type { AiProvider, SpendCap } from '../provider';
import { copilotContext, type CopilotRunFacts } from './facts';
import { filterCopilotOutput, type CopilotVerdicts } from './filter';
import { buildCopilotPrompt } from './prompt';

/** The purpose an eval run's calls are counted under, apart from the agent's own runs. */
export const COPILOT_EVAL_PURPOSE = 'copilot_eval';

/**
 * One case of the Co-pilot's eval or injection set: the prompt the facts make (a brief's or a
 * summary's), sent through the provider wrapper (masked and labelled as in a real run) and the
 * filter's verdict on the answer. The same path as `runCopilot()` between the facts and the
 * record; CI runs it on the fake transport with the recorded answers, and `eval:copilot` on the
 * live model.
 */
export async function evaluateCopilot(
  provider: AiProvider,
  facts: CopilotRunFacts,
  caps: readonly SpendCap[],
): Promise<{ text: string; verdicts: CopilotVerdicts }> {
  const prompt = buildCopilotPrompt(facts);
  const reply = await provider.complete({
    agent: 'agent:copilot',
    purpose: COPILOT_EVAL_PURPOSE,
    entityId: facts.entityId,
    caps,
    model: prompt.model,
    effort: prompt.effort,
    system: prompt.system,
    question: prompt.question,
    untrusted: prompt.untrusted,
    maxTokens: prompt.maxTokens,
    totalTimeoutMs: AGENT_DEFAULTS.copilot.totalTimeoutMs,
  });
  return { text: reply.text, verdicts: filterCopilotOutput(reply.text, copilotContext(facts)) };
}
