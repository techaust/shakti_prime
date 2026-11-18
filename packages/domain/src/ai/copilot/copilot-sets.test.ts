import { describe, expect, it } from 'vitest';
import {
  COPILOT_CASES,
  OUTCOMES,
  OWNER_ID,
  type ExpectedPart,
} from '../../../tests/fixtures/copilot-sets';
import { memoryKeyValue } from '../../ports/key-value';
import { memoryLogger } from '../../ports/logger';
import { AGENT_DEFAULTS } from '../agent-defaults';
import { createAiProvider } from '../provider';
import { fakeModelTransport, fakeReply } from '../transport';
import { evaluateCopilot } from './evaluate';
import type { CopilotDecision } from './filter';

// The Caller Co-pilot's eval and prompt-injection sets on recorded answers (A2, PRD AI-05): each
// case goes through the real prompt builder, the provider wrapper's masking and labelling, and the
// output filter, with the fake transport answering as the model did. Every injection case must
// fail safely, and every eval case must give the facts and outcome a person takes from the call.

function partOf(decision: CopilotDecision): ExpectedPart {
  if (decision === null) return 'nothing';
  return 'filtered' in decision ? decision.filtered : 'proposed';
}

describe.each(['eval', 'injection'] as const)('the Caller Co-pilot’s %s set', (set) => {
  const cases = COPILOT_CASES.filter((c) => c.set === set);

  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(5);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const transport = fakeModelTransport([fakeReply(c.recordedAnswer)]);
    const provider = createAiProvider({
      claude: transport,
      voyage: undefined,
      keyValue: memoryKeyValue(),
      logger: memoryLogger(),
    });
    const { verdicts } = await evaluateCopilot(provider, c.facts, [
      { paise: 100_000, entityId: c.facts.entityId },
    ]);

    expect({
      note: 'filtered' in verdicts.note ? verdicts.note.filtered : 'kept',
      qualification: partOf(verdicts.qualification),
      followUp: partOf(verdicts.followUp),
      template: partOf(verdicts.template),
    }).toEqual(c.expected);

    // An eval case gives the facts heard and the outcome a person logs.
    if (c.heard !== undefined && !('filtered' in verdicts.note)) {
      expect(verdicts.note.fields).toEqual(c.heard);
      const outcome = OUTCOMES.find((o) => o.code === c.outcome);
      expect(verdicts.note.suggestedDispositionId).toBe(outcome?.dispositionId ?? null);
    }
    // A follow-up is always for the lead's owner; nothing proposed is about another lead.
    for (const part of [verdicts.qualification, verdicts.followUp, verdicts.template]) {
      if (part === null || 'filtered' in part) continue;
      expect(part.subjectId).toBe(c.facts.opportunityId);
      if ('assigneeId' in part.input) expect(part.input.assigneeId).toBe(OWNER_ID);
    }

    // What reached the model: on the kind's model, masked, every outside text labelled as data,
    // and never the owner's id, a quote's id or anything priced.
    const [request] = transport.requests;
    if (request === undefined) throw new Error('the model was not asked');
    expect(request.model).toBe(
      c.facts.kind === 'brief'
        ? AGENT_DEFAULTS.copilot.briefModel
        : AGENT_DEFAULTS.copilot.summaryModel,
    );
    for (const text of c.neverSent ?? []) expect(request.user).not.toContain(text);
    for (const text of c.sentInstead ?? []) expect(request.user).toContain(text);
    if (c.facts.transcript !== undefined) {
      expect(request.user).toContain('<untrusted_data source="call_transcript">');
    }
    for (const m of c.facts.messages) {
      const source = m.direction === 'inbound' ? 'customer_message' : 'business_message';
      expect(request.user).toContain(`<untrusted_data source="${source}">`);
    }
    expect(request.user).not.toContain(OWNER_ID);
    for (const q of c.facts.quotes) expect(request.user).not.toContain(q.quoteId);
    expect(request.user).not.toMatch(/₹|\brs\.?\s*\d|price|cost/i);
  });
});
