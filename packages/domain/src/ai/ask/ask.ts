import {
  ASK_RETURNED_MAX,
  AskInput,
  DomainError,
  newId,
  type AskOutcome,
  type AskSource,
  type AskTurnDto,
  type Principal,
} from '@shakti/contracts';
import { executeCommand, executeQuery, type ExecuteOptions } from '../../command/execute';
import { checkPermission, isAgent } from '../../command/run-command';
import { recordAsk } from '../../commands/knowledge/ask';
import { istCalendarDate } from '../../numbering/financial-year';
import { jsonLogger, type Logger } from '../../ports/logger';
import { parseQueryInput } from '../../queries/parse-input';
import { loadAskConversation } from '../../queries/knowledge/ask';
import { AGENT_DEFAULTS } from '../agent-defaults';
import type { AiProvider, CompleteCall } from '../provider';
import { collectFigures, groundAnswer } from './grounding';
import { ASK_SYSTEM, askQuestion, LAST_LOOKUPS_NOTE } from './prompt';
import { companyNames, toolsFor, type AskTool, type AskToolContext } from './tools';

// Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5, PRD AI-02): a person's question
// answered by Sonnet 5.5 from read-only lookups run as that person, the answer passed through the
// grounding filter, then recorded with `knowledge.ask.record`. Every model call goes through the
// provider wrapper under Ask's own spend name, held to the group's daily cap and the person's
// share of it before it is sent, so a question past either cap reaches no model and no lookup.

const ASK = AGENT_DEFAULTS.ask;

export interface AskDeps {
  provider: AiProvider;
  logger?: Logger;
  now?: () => Date;
}

export interface AskOptions {
  requestId?: string;
  /**
   * The companies the person is viewing, for a new conversation; a follow-up keeps its
   * conversation's companies. The principal's companies when left out.
   */
  entityIds?: readonly number[];
  /** Told the name of each lookup as it starts, for a screen that shows the work going on. */
  onLookup?: (tool: string) => void;
  /** Passed on to `knowledge.ask.record` (the caller's address, the outbox nudge). */
  command?: Omit<ExecuteOptions, 'idempotencyKey'>;
}

/** The provider's refusal at a spend cap, in Ask's own words. */
function capReason(error: unknown): DomainError | undefined {
  if (
    error instanceof DomainError &&
    error.code === 'rate_limited' &&
    error.details?.reason === 'agent_spend_cap_reached'
  ) {
    const person = error.details.scope === 'person';
    return new DomainError(
      'rate_limited',
      person ? 'the person reached their daily Ask limit' : 'Ask reached its daily limit',
      { reason: person ? 'ask_person_cap_reached' : 'ask_cap_reached' },
      { cause: error },
    );
  }
  return undefined;
}

/** What a lookup answers the model when it cannot run, in words the model passes on. */
function lookupFailure(error: unknown): string {
  if (error instanceof DomainError) {
    if (error.code === 'forbidden') return 'The person asking may not read this.';
    if (error.code === 'integration_unavailable') return 'This lookup is not available now.';
    if (error.code === 'validation_failed')
      return 'The lookup was asked for with input it does not take.';
  }
  return 'This lookup failed. Answer without it.';
}

interface TurnState {
  returned: Map<string, AskSource>;
  figureTexts: string[];
  costPaise: number;
  model: string | null;
}

/** Runs one lookup the model asked for; its answer as text, or an error result. */
async function runLookup(
  tools: ReadonlyMap<string, AskTool>,
  toolCtx: AskToolContext,
  call: { id: string; name: string; input: unknown },
  turn: TurnState,
  logger: Logger,
): Promise<{ callId: string; source: string; content: string; isError?: boolean }> {
  const tool = tools.get(call.name);
  const source = call.name.replace(/[^a-z_]/gi, '_').slice(0, 40);
  if (tool === undefined) {
    return { callId: call.id, source, content: 'There is no such lookup.', isError: true };
  }
  const input = tool.input.safeParse(call.input);
  if (!input.success) {
    return {
      callId: call.id,
      source,
      content: lookupFailure(new DomainError('validation_failed')),
      isError: true,
    };
  }
  try {
    const output = await tool.run(toolCtx, input.data);
    for (const s of output.sources) turn.returned.set(s.id, s);
    const content = JSON.stringify(output.data);
    turn.figureTexts.push(content);
    return { callId: call.id, source, content };
  } catch (error) {
    const cap = capReason(error);
    if (cap !== undefined) throw cap;
    if (!(error instanceof DomainError)) {
      logger.log('error', 'ask.lookup_failed', {
        tool: call.name,
        requestId: toolCtx.requestId,
        error,
      });
    }
    return { callId: call.id, source, content: lookupFailure(error), isError: true };
  }
}

/**
 * Answers one question of the person's, in a new conversation or a follow-up of theirs, and
 * records it. Refused for an agent principal and without `knowledge.ask`; answers
 * `integration_unavailable` (`ask_unavailable`) while no model key is set, and `rate_limited`
 * (`ask_person_cap_reached`, `ask_cap_reached`) once a daily cap is reached.
 */
export async function askTheBusiness(
  principal: Principal,
  rawInput: unknown,
  deps: AskDeps,
  options: AskOptions = {},
): Promise<AskTurnDto> {
  if (isAgent(principal)) {
    throw new DomainError('forbidden', 'Ask the Business is for people, not agents');
  }
  checkPermission(principal, 'knowledge.ask', 'team');
  const input = parseQueryInput(AskInput, rawInput, 'knowledge.ask');
  const logger = deps.logger ?? jsonLogger();
  const now = (deps.now ?? (() => new Date()))();
  const requestId = options.requestId ?? newId();
  const viewing = [...(options.entityIds ?? principal.entityIds)];

  const earlier =
    input.conversationId === null
      ? undefined
      : await executeQuery(
          principal,
          { entityIds: viewing, requestId },
          (c) => loadAskConversation(c, input.conversationId ?? '', ASK.earlierTurns),
          { name: 'ask.conversation' },
        );
  const entityIds = earlier?.conversation.entityIds ?? viewing;
  if (!deps.provider.claudeAvailable) {
    throw new DomainError('integration_unavailable', 'no model key is set', {
      reason: 'ask_unavailable',
    });
  }

  const companies = await companyNames(principal, entityIds, requestId);
  const tools = toolsFor(principal);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const toolCtx: AskToolContext = {
    principal,
    entityIds,
    requestId,
    provider: deps.provider,
    now,
    companies,
  };
  const today = istCalendarDate(now);
  const question = askQuestion(
    input.question,
    today,
    entityIds.map((e) => companies.get(e) ?? `company ${String(e)}`),
  );
  const turn: TurnState = {
    returned: new Map((earlier?.returned ?? []).map((s) => [s.id, s])),
    figureTexts: [input.question, today],
    costPaise: 0,
    model: null,
  };
  const earlierTurns = (earlier?.recent ?? []).flatMap((m) => [
    { source: 'earlier_question', text: m.question },
    { source: 'earlier_answer', text: m.answer },
  ]);
  const thisTurn = new Map<string, AskSource>();
  const rounds: NonNullable<CompleteCall['rounds']>[number][] = [];

  let text = '';
  let stopped: 'finished' | 'too_long' | 'refused' | 'lookups' = 'lookups';
  for (let call = 1; call <= ASK.maxModelCalls; call += 1) {
    let result;
    try {
      result = await deps.provider.complete({
        agent: ASK.spendName,
        purpose: 'ask',
        entityId: entityIds.length === 1 ? (entityIds[0] ?? null) : null,
        caps: [{ paise: ASK.dailyCapPaise, entityId: null }],
        person: { id: principal.id, capPaise: ASK.personDailyCapPaise },
        model: ASK.model,
        effort: ASK.effort,
        maxTokens: ASK.maxTokens,
        totalTimeoutMs: ASK.totalTimeoutMs,
        system: ASK_SYSTEM,
        ...(earlierTurns.length === 0 ? {} : { untrusted: earlierTurns }),
        question,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        ...(rounds.length === 0 ? {} : { rounds }),
      });
    } catch (error) {
      throw capReason(error) ?? error;
    }
    turn.costPaise += result.costPaise;
    turn.model = result.model;
    const calls = result.toolCalls ?? [];
    if (calls.length === 0 || result.stopped !== 'finished') {
      text = result.text;
      stopped = result.stopped;
      break;
    }
    if (call === ASK.maxModelCalls) break;
    const results = [];
    for (const c of calls) {
      options.onLookup?.(c.name);
      const before = new Set(turn.returned.keys());
      results.push(await runLookup(byName, toolCtx, c, turn, logger));
      for (const [id, s] of turn.returned) if (!before.has(id)) thisTurn.set(id, s);
    }
    if (call === ASK.maxModelCalls - 1) {
      for (const r of results) r.content = `${r.content}\n${LAST_LOOKUPS_NOTE}`;
    }
    rounds.push({ assistant: result.assistant, results });
  }

  let answer = '';
  let outcome: AskOutcome = 'no_answer';
  let cited: AskSource[] = [];
  let unsourced = 0;
  if (stopped === 'finished' && text.trim() !== '') {
    const grounded = groundAnswer(text, {
      returned: turn.returned,
      figures: collectFigures(turn.figureTexts),
    });
    if (grounded.text !== '') {
      answer = grounded.text;
      cited = grounded.cited;
      unsourced = grounded.unsourced;
      outcome = unsourced > 0 ? 'unsourced' : 'answered';
    }
  }
  logger.log('info', 'ask.answered', {
    requestId,
    outcome,
    stopped,
    rounds: rounds.length,
    cited: cited.length,
    unsourced,
    costPaise: turn.costPaise,
  });
  return executeCommand(
    principal,
    { entityIds: [...entityIds], requestId },
    recordAsk,
    {
      conversationId: earlier?.conversation.id ?? newId(),
      question: input.question,
      answer,
      outcome,
      unsourced,
      cited,
      // What this turn's lookups returned, the records it cites first, so the cap never drops one.
      returned: [
        ...new Map(
          [...cited.filter((s) => thisTurn.has(s.id)), ...thisTurn.values()].map((s) => [s.id, s]),
        ).values(),
      ].slice(0, ASK_RETURNED_MAX),
      model: turn.model,
      costPaise: turn.costPaise,
    },
    options.command ?? {},
  );
}
