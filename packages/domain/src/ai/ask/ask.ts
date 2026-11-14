import {
  ASK_RETURNED_MAX,
  AskInput,
  AskTurnDto,
  type AskLookup,
  DomainError,
  newId,
  type AskOutcome,
  type AskSource,
  type Principal,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { executeCommand, executeQuery, type ExecuteOptions } from '../../command/execute';
import { checkPermission, isAgent } from '../../command/run-command';
import { recordAsk } from '../../commands/knowledge/ask';
import { istCalendarDate } from '../../numbering/financial-year';
import type { KeyValue } from '../../ports/key-value';
import { jsonLogger, type Logger } from '../../ports/logger';
import { parseQueryInput } from '../../queries/parse-input';
import { loadAskConversation } from '../../queries/knowledge/ask';
import { AGENT_DEFAULTS } from '../agent-defaults';
import { spendKey, type AiProvider, type CompleteCall } from '../provider';
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
  onLookup?: (tool: AskLookup) => void;
  /** Passed on to `knowledge.ask.record` (the caller's address, the outbox nudge). */
  command?: Omit<ExecuteOptions, 'idempotencyKey'>;
  /**
   * The caller's key for this question (docs/06-api.md §1): a question already answered under it
   * is answered again from its record, with no model call and no lookup.
   */
  idempotencyKey?: string;
}

/**
 * The key of one person's spend of a day, as the provider wrapper keeps it (`CallBase.person`); a
 * test holds the two together.
 */
export function personSpendKey(agent: string, personId: string, day: string): string {
  return `ai:spend:${agent}:person:${personId}:${day}`;
}

/** Where a daily cap stands before a question: `person` or `group` when one is reached. */
export async function askCapReached(
  keyValue: KeyValue,
  personId: string,
  now: Date = new Date(),
): Promise<'person' | 'group' | undefined> {
  const day = istCalendarDate(now);
  const spent = async (key: string) => Number((await keyValue.get(key)) ?? 0);
  if ((await spent(spendKey(ASK.spendName, null, day))) >= ASK.dailyCapPaise) return 'group';
  if ((await spent(personSpendKey(ASK.spendName, personId, day))) >= ASK.personDailyCapPaise) {
    return 'person';
  }
  return undefined;
}

/** The answer recorded under the caller's key for this question, if one was. */
function recordedTurn(principal: Principal, key: string): Promise<AskTurnDto | undefined> {
  return executeQuery(
    principal,
    {},
    async ({ tx }) => {
      const k = schema.idempotencyKeys;
      const [row] = await tx
        .select({ command: k.command, response: k.responseJson })
        .from(k)
        .where(and(eq(k.principalId, principal.id), eq(k.key, key)))
        .limit(1);
      if (row?.command !== recordAsk.name) return undefined;
      const answer = AskTurnDto.safeParse(row.response);
      return answer.success ? answer.data : undefined;
    },
    // The keys are the caller's own and only `app_user` reads them (0037).
    { name: 'ask.recorded', pool: 'app_user' },
  );
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
  if (options.idempotencyKey !== undefined) {
    const recorded = await recordedTurn(principal, options.idempotencyKey);
    if (recorded !== undefined) return recorded;
  }

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
      const known = byName.get(c.name);
      if (known !== undefined) options.onLookup?.(known.name as AskLookup);
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
  const record = {
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
  };
  try {
    return await executeCommand(
      principal,
      { entityIds: [...entityIds], requestId },
      recordAsk,
      record,
      {
        ...(options.command ?? {}),
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      },
    );
  } catch (error) {
    // Another call with the same key recorded its answer while this one asked the model.
    if (
      options.idempotencyKey !== undefined &&
      error instanceof DomainError &&
      error.details?.reason === 'idempotency_mismatch'
    ) {
      const recorded = await recordedTurn(principal, options.idempotencyKey);
      if (recorded !== undefined) return recorded;
    }
    throw error;
  }
}
