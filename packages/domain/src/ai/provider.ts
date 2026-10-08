import { DomainError, type AgentRoleKey } from '@shakti/contracts';
import type { AGENT_DEFAULTS } from './agent-defaults';
import { labelUntrusted, maskForModel } from '../privacy/model-text';
import type { KeyValue } from '../ports/key-value';
import type { Logger } from '../ports/logger';
import {
  costInPaise,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  isKnownModel,
  maxCostInPaise,
  MODEL_CONTEXT_TOKENS,
  type TokenUsage,
} from './models';
import {
  ModelCallError,
  type ModelDocument,
  type EmbeddingTransport,
  type ModelReply,
  type ModelTransport,
} from './transport';

// The one way the BOS calls a language model or an embedding model (ADR 0011, AGENTS §9): every
// call names its agent and purpose, its text is masked, it has a timeout, a few retries and a
// circuit breaker in Redis, and it is held against the agent's daily spend caps in paise: the most
// it can cost is reserved before it is sent, and the reservation is settled at what it cost once it
// answers (or released when it fails). Without a vendor key the wrapper answers
// `integration_unavailable` and nothing calls out.

/** Per attempt. A model answer for a triage-sized prompt takes a few seconds. */
export const AI_CALL_TIMEOUT_MS = 20_000;
/** Attempts after the first, for a timeout, a network failure, a 429 or a 5xx only. */
export const AI_CALL_RETRIES = 2;
const BACKOFF_MS = 500;

/** Failed calls in a row, within a minute, that open the breaker; it stays open a minute. */
export const BREAKER_FAILURES = 5;
export const BREAKER_WINDOW_SECONDS = 60;
export const BREAKER_OPEN_SECONDS = 60;

/** A day's spend is kept two days, long enough to cross midnight in any timezone. */
const SPEND_TTL_SECONDS = 2 * 24 * 60 * 60;

type Vendor = 'anthropic' | 'voyage';

/** A spend cap that applies to a call: its paise, and the company it covers or the group. */
export interface SpendCap {
  paise: number;
  /** The company of the setting the cap came from; null for the group's. */
  entityId: number | null;
}

/**
 * Who a call's spend is counted under: an agent, or the Knowledge Vault's own work, which no agent
 * does (`AGENT_DEFAULTS.knowledge`).
 */
export type AiSpender =
  | AgentRoleKey
  | (typeof AGENT_DEFAULTS.knowledge)['indexName']
  | (typeof AGENT_DEFAULTS.knowledge)['searchName'];

interface CallBase {
  agent: AiSpender;
  /** What the call is for, as a code (`lead_triage`). */
  purpose: string;
  /**
   * The company the call works for: its spend counts there and in the group. Null for work of the
   * whole group (a vault file for every company), counted in the group's total only.
   */
  entityId: number | null;
  /**
   * Every cap that applies (the company's, the group's, or both): the call is refused if its
   * reservation would take the spend past either. No cap means no call.
   */
  caps: readonly SpendCap[];
  /**
   * One person's daily share of the spend, counted beside the caps: the call is refused, with
   * `details.scope` `person`, if the person's total for the day would pass `capPaise`.
   */
  person?: { id: string; capPaise: number };
  /**
   * Milliseconds the whole call may take, every attempt and pause between them included; past
   * it the call stops with `integration_unavailable` and `details.reason` `ai_deadline_exceeded`,
   * its reservation settled. Left out, only each attempt's own timeout applies.
   */
  totalTimeoutMs?: number;
}

/** What a call holds against the caps while it runs: the company's total (if any), then the group's. */
interface Reservation {
  keys: readonly string[];
  paise: number;
}

export interface CompleteCall extends CallBase {
  model?: string;
  /** Our own instructions; stable, so the vendor can cache them. */
  system: string;
  /** Data from outside the business, each labelled as data (BLUEPRINT §7.8). */
  untrusted?: readonly { source: string; text: string }[];
  /** The question, from the agent's own code. */
  question: string;
  /**
   * Files the model reads with the question: a PDF, or a photo the file checks have masked. They
   * cannot be masked here, so only a vault file that passed its checks is sent; the call reserves
   * the model's whole context window against the caps, since their tokens cannot be counted first.
   */
  documents?: readonly ModelDocument[];
  maxTokens?: number;
  /**
   * Milliseconds per attempt, for a call that writes a long answer (copying out a vault file's
   * text); `AI_CALL_TIMEOUT_MS` when left out.
   */
  timeoutMs?: number;
}

export interface CompleteResult {
  text: string;
  model: string;
  usage: TokenUsage;
  costPaise: number;
  stopped: ModelReply['stopped'];
}

export interface EmbedCall extends CallBase {
  model?: string;
  texts: readonly string[];
  inputType: 'document' | 'query';
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  tokens: number;
  costPaise: number;
}

export interface AiProviderDeps {
  /** Claude, or undefined when `ANTHROPIC_API_KEY` is not set. */
  claude: ModelTransport | undefined;
  /** Voyage, or undefined when `VOYAGE_API_KEY` is not set. */
  voyage: EmbeddingTransport | undefined;
  keyValue: KeyValue;
  logger: Logger;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retries?: number;
}

export interface AiProvider {
  readonly claudeAvailable: boolean;
  readonly embeddingsAvailable: boolean;
  complete(call: CompleteCall): Promise<CompleteResult>;
  embed(call: EmbedCall): Promise<EmbedResult>;
}

/** The day in India a moment falls on, `YYYY-MM-DD`: caps reset at midnight IST. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** The key holding one agent's spend today, in a company or (null) the group. */
export function spendKey(agent: string, entityId: number | null, day: string): string {
  return `ai:spend:${agent}:${entityId === null ? 'all' : String(entityId)}:${day}`;
}

/** The length of a text in UTF-8 bytes, the most tokens it can be. */
const bytes = (text: string): number => new TextEncoder().encode(text).length;

const breakerOpenKey = (vendor: Vendor): string => `ai:breaker:${vendor}:open`;
const breakerFailuresKey = (vendor: Vendor): string => `ai:breaker:${vendor}:failures`;

function unavailable(message: string, cause?: unknown): DomainError {
  return new DomainError('integration_unavailable', message, {}, { cause });
}

/** A store call the wrapper cannot go on without: a failure means the model is not called. */
async function store<T>(message: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw unavailable(message, error);
  }
}

export function createAiProvider(deps: AiProviderDeps): AiProvider {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = deps.timeoutMs ?? AI_CALL_TIMEOUT_MS;
  const retries = deps.retries ?? AI_CALL_RETRIES;
  const { keyValue, logger } = deps;

  /** Refuses a call while the vendor's breaker is open. */
  async function breakerClosed(vendor: Vendor): Promise<void> {
    if (await store('the breaker could not be read', () => keyValue.get(breakerOpenKey(vendor)))) {
      throw unavailable(`${vendor} is paused after repeated failures`);
    }
  }

  function capReached(call: CallBase, scope?: 'person'): DomainError {
    return new DomainError('rate_limited', `${call.agent} reached its daily spend cap`, {
      reason: 'agent_spend_cap_reached',
      ...(scope === undefined ? {} : { scope }),
    });
  }

  /** Moves both of a reservation's running totals by `paise`; a failure only leaves them behind. */
  async function move(call: CallBase, held: Reservation, paise: number): Promise<void> {
    if (paise === 0) return;
    try {
      for (const key of held.keys) await keyValue.incrBy(key, paise, SPEND_TTL_SECONDS);
    } catch (error) {
      // The run's row keeps the cost; only the caps' running totals are off.
      logger.log('warn', 'ai.spend_not_recorded', { agent: call.agent, paise, error });
    }
  }

  /**
   * Reserves the most a call can cost in the company's and the group's running totals, in one
   * step each, and refuses the call, giving the reservation back, if either total is then past
   * its cap; so two calls at once cannot both pass a cap.
   */
  async function reserve(call: CallBase, paise: number): Promise<Reservation> {
    if (call.caps.length === 0) throw capReached(call);
    const day = istDay(now());
    const keys =
      call.entityId === null
        ? [spendKey(call.agent, null, day)]
        : [spendKey(call.agent, call.entityId, day), spendKey(call.agent, null, day)];
    const personKey =
      call.person === undefined
        ? undefined
        : `ai:spend:${call.agent}:person:${call.person.id}:${day}`;
    const held: readonly string[] = personKey === undefined ? keys : [...keys, personKey];
    const totals: number[] = [];
    for (const key of held) {
      try {
        totals.push(await keyValue.incrBy(key, paise, SPEND_TTL_SECONDS));
      } catch (error) {
        // Give back what this call already reserved before refusing it.
        for (const done of held.slice(0, totals.length)) {
          await keyValue.incrBy(done, -paise, SPEND_TTL_SECONDS).catch(() => undefined);
        }
        throw unavailable('the spend could not be reserved', error);
      }
    }
    const group = totals[keys.length - 1] ?? 0;
    // A call of the whole group has no company total: a company's cap is held against the group's.
    const company = totals[0] ?? group;
    const reservation: Reservation = { keys: held, paise };
    if (call.caps.some((cap) => (cap.entityId === null ? group : company) > cap.paise)) {
      await move(call, reservation, -paise);
      throw capReached(call);
    }
    if (call.person !== undefined && (totals[keys.length] ?? 0) > call.person.capPaise) {
      await move(call, reservation, -paise);
      throw capReached(call, 'person');
    }
    return reservation;
  }

  /** Settles a reservation at what the call cost: zero when it failed. */
  function settle(call: CallBase, held: Reservation, costPaise: number): Promise<void> {
    return move(call, held, costPaise - held.paise);
  }

  /** One vendor call with its timeout and retries; the breaker counts what still fails. */
  async function attempt<T>(
    vendor: Vendor,
    send: (signal: AbortSignal) => Promise<T>,
    perAttemptMs: number = timeoutMs,
    totalMs?: number,
  ): Promise<T> {
    let last: ModelCallError | undefined;
    const began = Date.now();
    const remaining = () => (totalMs === undefined ? Infinity : totalMs - (Date.now() - began));
    for (let i = 0; i <= retries; i += 1) {
      if (remaining() <= 0) break;
      try {
        const answer = await send(AbortSignal.timeout(Math.min(perAttemptMs, remaining())));
        await keyValue.del(breakerFailuresKey(vendor)).catch(() => undefined);
        return answer;
      } catch (error) {
        last =
          error instanceof ModelCallError ? error : new ModelCallError('network', { cause: error });
        if (!last.retryable) break;
        if (i < retries) await sleep(Math.min(BACKOFF_MS * 2 ** i, Math.max(0, remaining())));
      }
    }
    const failed = last ?? new ModelCallError('timeout');
    const pastDeadline = remaining() <= 0;
    if (failed.retryable) {
      try {
        const failures = await keyValue.incr(breakerFailuresKey(vendor), BREAKER_WINDOW_SECONDS);
        if (failures >= BREAKER_FAILURES) {
          await keyValue.set(breakerOpenKey(vendor), '1', BREAKER_OPEN_SECONDS);
          logger.log('warn', 'ai.breaker_opened', { vendor, failures });
        }
      } catch (error) {
        logger.log('warn', 'ai.breaker_not_recorded', { vendor, error });
      }
    }
    if (pastDeadline) {
      throw new DomainError(
        'integration_unavailable',
        `${vendor} call went past its deadline`,
        { reason: 'ai_deadline_exceeded' },
        { cause: failed },
      );
    }
    throw unavailable(`${vendor} call failed: ${failed.message}`, failed);
  }

  function modelOf(requested: string | undefined, fallback: string): string {
    const model = requested ?? fallback;
    if (!isKnownModel(model)) throw new DomainError('internal', `no price for model ${model}`);
    return model;
  }

  return {
    claudeAvailable: deps.claude !== undefined,
    embeddingsAvailable: deps.voyage !== undefined,

    async complete(call) {
      const claude = deps.claude;
      if (claude === undefined) throw unavailable('ANTHROPIC_API_KEY is not set');
      const model = modelOf(call.model, DEFAULT_CLAUDE_MODEL);
      await breakerClosed('anthropic');
      const system = maskForModel(call.system);
      const user = [
        ...(call.untrusted ?? []).map((d) => labelUntrusted(d.source, d.text)),
        maskForModel(call.question),
      ].join('\n\n');
      const maxTokens = call.maxTokens ?? 1024;
      const documents = call.documents ?? [];
      // A document's tokens cannot be counted from its bytes; the context window bounds them all.
      const inputBound =
        documents.length > 0
          ? (MODEL_CONTEXT_TOKENS[model] ?? Number.MAX_SAFE_INTEGER)
          : bytes(system) + bytes(user);
      const held = await reserve(call, maxCostInPaise(model, inputBound, maxTokens));
      const started = now().getTime();
      let reply: ModelReply;
      try {
        reply = await attempt(
          'anthropic',
          (signal) =>
            claude.complete(
              { model, system, user, maxTokens, ...(documents.length > 0 ? { documents } : {}) },
              signal,
            ),
          call.timeoutMs ?? timeoutMs,
          call.totalTimeoutMs,
        );
      } catch (error) {
        await settle(call, held, 0);
        throw error;
      }
      const costPaise = costInPaise(model, reply.usage);
      await settle(call, held, costPaise);
      logger.log('info', 'ai.call', {
        agent: call.agent,
        purpose: call.purpose,
        model,
        tokensIn:
          reply.usage.inputTokens + reply.usage.cacheReadTokens + reply.usage.cacheWriteTokens,
        tokensOut: reply.usage.outputTokens,
        documents: documents.length,
        costPaise,
        stopped: reply.stopped,
        durationMs: now().getTime() - started,
      });
      return { text: reply.text, model, usage: reply.usage, costPaise, stopped: reply.stopped };
    },

    async embed(call) {
      const voyage = deps.voyage;
      if (voyage === undefined) throw unavailable('VOYAGE_API_KEY is not set');
      const model = modelOf(call.model, DEFAULT_EMBEDDING_MODEL);
      await breakerClosed('voyage');
      const texts = call.texts.map(maskForModel);
      const held = await reserve(
        call,
        maxCostInPaise(
          model,
          texts.reduce((sum, t) => sum + bytes(t), 0),
          0,
        ),
      );
      let reply: Awaited<ReturnType<EmbeddingTransport['embed']>>;
      try {
        reply = await attempt(
          'voyage',
          (signal) => voyage.embed({ model, texts, inputType: call.inputType }, signal),
          timeoutMs,
          call.totalTimeoutMs,
        );
      } catch (error) {
        await settle(call, held, 0);
        throw error;
      }
      const costPaise = costInPaise(model, {
        inputTokens: reply.tokens,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      await settle(call, held, costPaise);
      logger.log('info', 'ai.embed', {
        agent: call.agent,
        purpose: call.purpose,
        model,
        texts: texts.length,
        tokens: reply.tokens,
        costPaise,
      });
      return { vectors: reply.vectors, model, tokens: reply.tokens, costPaise };
    },
  };
}
