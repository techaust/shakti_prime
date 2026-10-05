// A stand-in agent for the Agent Inbox journeys, defined here only: no real agent ships in AI0
// (docs/design/phase1.md §7.1; the Triage agent is A1's). It runs through the real runtime as the
// seeded Caller Co-pilot principal, asks the model through the provider wrapper, and files a
// follow-up task as a suggestion. The model is the fake transport, which answers the follow-up the
// seed asks for; nothing reaches a vendor.
import { newId, type AgentRunDto } from '@shakti/contracts';
import {
  createAiProvider,
  fakeModelTransport,
  fakeReply,
  memoryKeyValue,
  memoryLogger,
  runAgentStep,
} from '@shakti/domain';

export interface FollowUp {
  entityId: number;
  opportunityId: string;
  title: string;
  dueAt: string;
  /** Who the suggestion and its task are for. */
  assigneeId: string;
}

export async function suggestFollowUp(followUp: FollowUp): Promise<AgentRunDto> {
  const transport = fakeModelTransport([
    fakeReply(JSON.stringify({ title: followUp.title, dueAt: followUp.dueAt })),
  ]);
  const logger = memoryLogger();
  const provider = createAiProvider({
    claude: transport,
    voyage: undefined,
    keyValue: memoryKeyValue(),
    logger,
  });
  const answer = await runAgentStep(
    {
      agent: 'agent:copilot',
      entityId: followUp.entityId,
      // Each suggestion stands for an event of its own.
      eventId: newId(),
      purpose: 'follow_up',
      actionType: 'crm.task.create',
      async decide(model) {
        const reply = await model.complete({
          system: 'You suggest the next follow-up on a lead.',
          question: 'Answer with the follow-up as JSON: a title and a due time.',
          maxTokens: 100,
        });
        const parsed = JSON.parse(reply.text) as { title: string; dueAt: string };
        return {
          input: {
            entityId: followUp.entityId,
            opportunityId: followUp.opportunityId,
            kind: 'follow_up',
            dueAt: parsed.dueAt,
            title: parsed.title,
          },
          subjectType: 'opportunity',
          subjectId: followUp.opportunityId,
          assigneeId: followUp.assigneeId,
        };
      },
    },
    { provider, logger },
  );
  if (answer.outcome !== 'proposed') {
    throw new Error(`the stand-in agent's run ended ${answer.outcome}, not with a suggestion`);
  }
  return answer;
}
