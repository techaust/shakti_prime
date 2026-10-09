import { TRIAGE_PROPOSAL_KINDS } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { TRIAGE_CASES, type ExpectedVerdict } from '../../../tests/fixtures/triage-sets';
import { memoryKeyValue } from '../../ports/key-value';
import { memoryLogger } from '../../ports/logger';
import { createAiProvider } from '../provider';
import { fakeModelTransport, fakeReply } from '../transport';
import { evaluateTriage } from './evaluate';
import type { TriageDecision } from './filter';

// The eval and prompt-injection sets of the Triage agent on recorded answers (A1, PRD AI-05):
// each case goes through the real prompt builder, the provider wrapper's masking and labelling,
// and the output filter, with the fake transport answering as the model did. Every injection
// case must fail safely.

function verdictOf(decision: TriageDecision): ExpectedVerdict {
  if (decision === null) return 'nothing';
  return 'filtered' in decision ? decision.filtered : 'proposed';
}

describe.each(['eval', 'injection'] as const)('the Triage agent’s %s set', (set) => {
  const cases = TRIAGE_CASES.filter((c) => c.set === set);

  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(4);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const transport = fakeModelTransport([fakeReply(c.recordedAnswer)]);
    const provider = createAiProvider({
      claude: transport,
      voyage: undefined,
      keyValue: memoryKeyValue(),
      logger: memoryLogger(),
    });
    const { verdicts } = await evaluateTriage(provider, c.facts, [
      { paise: 100_000, entityId: c.facts.entityId },
    ]);

    const got = Object.fromEntries(TRIAGE_PROPOSAL_KINDS.map((k) => [k, verdictOf(verdicts[k])]));
    expect(got).toEqual(c.expected);
    for (const [kind, input] of Object.entries(c.expectedInput ?? {})) {
      const decision = verdicts[kind as keyof typeof verdicts];
      expect(decision !== null && !('filtered' in decision)).toBe(true);
      if (decision !== null && !('filtered' in decision)) {
        expect(decision.input).toMatchObject(input);
        expect(decision).toMatchObject({ subjectType: 'opportunity', subjectId: c.facts.opportunityId });
      }
    }

    // What reached the model: masked, every outside field labelled as data.
    const [request] = transport.requests;
    if (request === undefined) throw new Error('the model was not asked');
    for (const text of c.neverSent ?? []) expect(request.user).not.toContain(text);
    for (const text of c.sentInstead ?? []) expect(request.user).toContain(text);
    for (const u of c.facts.untrusted) {
      expect(request.user).toContain(`<untrusted_data source="lead_${u.field}">`);
    }
    // Ids reach the model only as labels (unless an outside field wrote one itself).
    const written = c.facts.untrusted.map((u) => u.text).join('\n');
    const ids = [
      ...c.facts.people.map((p) => p.personId),
      ...c.facts.candidates.map((d) => d.otherOpportunityId),
    ].filter((id) => !written.includes(id));
    for (const id of ids) expect(request.user).not.toContain(id);
  });
});
