import { DomainError, type AgentRoleKey } from '@shakti/contracts';
import { labelUntrusted, maskForModel } from '../privacy/model-text';
import type { KeyValue } from '../ports/key-value';
import type { Logger } from '../ports/logger';
import {
  costInPaise,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  isKnownModel,
  type TokenUsage,
} from './models';
import {
  ModelCallError,
  type EmbeddingTransport,
  type ModelReply,
  type ModelTransport,
} from './transport';

// The one way the BOS calls a language model or an embedding model (ADR 0011, AGENTS §9): every
// call names its agent and purpose, its text is masked, it has a timeout, a few retries and a
// circuit breaker in Redis, and it is charged against the agent's daily spend cap in paise,
// checked before the call and recorded after it. Without a vendor key the wrapper answers
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

/** The spend cap that applies to a call: its paise, and the company it covers or the group. */
export interface SpendCap {
  paise: number;
  /** The company of the setting the cap came from; null for the group's. */
  entityId: number | null;
}

interface CallBase {
  agent: AgentRoleKey;
  /** What the call is for, as a code (`lead_triage`). */
  purpose: string;
  /** The company the call works for: its spend counts there and in the group. */
  entityId: number;
  cap: SpendCap;
}

export interface CompleteCall extends CallBase {
  model?: string;
  /** Our own instructions; stable, so the vendor can cache them. */
  system: string;
  /** Data from outside the business, each labelled as data (BLUEPRINT §7.8). */
  untrusted?: readonly { source: string; text: string }[];
  /** The question, from the agent's own code. */
  question: string;
  maxTokens?: number;
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

  /** Refuses a call over its cap, or while the vendor's breaker is open. */
  async function before(call: CallBase, vendor: Vendor): Promise<void> {
    if (await store('the breaker could not be read', () => keyValue.get(breakerOpenKey(vendor)))) {
      throw unavailable(`${vendor} is paused after repeated failures`);
    }
    const spent = await store('the spend could not be read', () =>
      keyValue.get(spendKey(call.agent, call.cap.entityId, istDay(now()))),
    );
    if (Number(spent ?? '0') >= call.cap.paise) {
      throw new DomainError('rate_limited', `${call.agent} reached its daily spend cap`, {
        reason: 'agent_spend_cap_reached',
      });
    }
  }

  /** Records what a call cost, in the company and in the group. */
  async function charge(call: CallBase, paise: number): Promise<void> {
    if (paise <= 0) return;
    const day = istDay(now());
    try {
      await keyValue.incrBy(spendKey(call.agent, call.entityId, day), paise, SPEND_TTL_SECONDS);
      await keyValue.incrBy(spendKey(call.agent, null, day), paise, SPEND_TTL_SECONDS);
    } catch (error) {
      // The run's row keeps the cost; only the cap's running total is behind.
      logger.log('warn', 'ai.spend_not_recorded', { agent: call.agent, paise, error });
    }
  }

  /** One vendor call with its timeout and retries; the breaker counts what still fails. */
  async function attempt<T>(vendor: Vendor, send: (signal: AbortSignal) => Promise<T>): Promise<T> {
    let last: ModelCallError | undefined;
    for (let i = 0; i <= retries; i += 1) {
      try {
        const answer = await send(AbortSignal.timeout(timeoutMs));
        await keyValue.del(breakerFailuresKey(vendor)).catch(() => undefined);
        return answer;
      } catch (error) {
        last = error instanceof ModelCallError ? error : new ModelCallError('network', { cause: error });
        if (!last.retryable) break;
        if (i < retries) await sleep(BACKOFF_MS * 2 ** i);
      }
    }
    const failed = last ?? new ModelCallError('network');
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
      await before(call, 'anthropic');
      const user = [
        ...(call.untrusted ?? []).map((d) => labelUntrusted(d.source, d.text)),
        maskForModel(call.question),
      ].join('\n\n');
      const started = now().getTime();
      const reply = await attempt('anthropic', (signal) =>
        claude.complete(
          { model, system: maskForModel(call.system), user, maxTokens: call.maxTokens ?? 1024 },
          signal,
        ),
      );
      const costPaise = costInPaise(model, reply.usage);
      await charge(call, costPaise);
      logger.log('info', 'ai.call', {
        agent: call.agent,
        purpose: call.purpose,
        model,
        tokensIn: reply.usage.inputTokens + reply.usage.cacheReadTokens + reply.usage.cacheWriteTokens,
        tokensOut: reply.usage.outputTokens,
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
      await before(call, 'voyage');
      const texts = call.texts.map(maskForModel);
      const reply = await attempt('voyage', (signal) =>
        voyage.embed({ model, texts, inputType: call.inputType }, signal),
      );
      const costPaise = costInPaise(model, {
        inputTokens: reply.tokens,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      await charge(call, costPaise);
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
