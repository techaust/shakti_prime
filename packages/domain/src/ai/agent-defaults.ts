// The agents' named defaults (docs/03-roadmap-appendix/phase1.md §7.1 "Built (AI0)", the owner's decisions of
// 05-10-2026). Each one is flagged for the owner to confirm; a change is made here and nowhere
// else. Prices are kept in US dollars per million tokens, as the vendors publish them.

/** One model's published price, in US dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Input read from the prompt cache. */
  cacheRead: number;
  /** Input written to the prompt cache (the five-minute write). */
  cacheWrite: number;
  /**
   * Dearer prices for a call whose prompt (input, cache reads and cache writes together) is over
   * `overPromptTokens`, where the vendor prices by prompt length (Haiku 5.5 over 100,000 tokens).
   */
  longPrompt?: {
    overPromptTokens: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

/** The record an action type needs before an agent may take it on its own (BLUEPRINT §9.3). */
export interface PromotionRule {
  /** Decisions in the window, at least. */
  minDecided: number;
  /** Of those, the share approved without an edit, at least. */
  minUneditedShare: number;
  /** The rolling window the decisions are counted in, in days. */
  windowDays: number;
  /** Which suggestions count: only those filed under this autonomy. */
  countedAutonomy: 'needs_approval';
}

export const AGENT_DEFAULTS = {
  /**
   * Paise a US dollar of model spend costs, for the daily spend caps: ₹88 a dollar plus 18% GST
   * on imported services is ₹103.84, rounded up to ₹104. Flagged for the owner to confirm from
   * the card statement; a change moves only how fast a cap is reached.
   */
  paisePerUsd: 10_400,

  /**
   * The models an agent may call and their prices, each as published on its date in
   * `pricesCheckedOn`: Haiku 4.5 and the Voyage embeddings (Phase 1), Sonnet 5.5 and Haiku 5.5
   * (Phase 2, question 1 (a) of docs/03-roadmap-appendix/phase2.md). The Claude prices are from
   * Anthropic's pricing page (platform.claude.com/docs/en/about-claude/pricing), the five-minute
   * cache write as `cacheWrite`. Flagged for the owner to check against the vendors' price pages;
   * a call naming any other model is refused.
   */
  pricesCheckedOn: {
    'claude-haiku-4-5-20251001': '2026-11-13',
    'claude-sonnet-5-5': '2026-11-13',
    'claude-haiku-5-5': '2026-11-13',
    'voyage-3.5': '2026-10-05',
  },
  modelPrices: {
    'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    'claude-haiku-5-5': {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
      longPrompt: {
        overPromptTokens: 100_000,
        input: 0.5,
        output: 2.5,
        cacheRead: 0.05,
        cacheWrite: 0.625,
      },
    },
    'voyage-3.5': { input: 0.06, output: 0, cacheRead: 0, cacheWrite: 0 },
  } satisfies Record<string, ModelPrice>,

  /**
   * Automatic is not available in Phase 1 (the owner, 05-10-2026): the level is in the data
   * model, but `agents.config.set` refuses it until Phase 6 and the screen shows it unavailable.
   */
  automaticAvailable: false,

  /**
   * The promotion rule for Phase 6, flagged for later: at least 200 decisions on the action type
   * in the last 90 days, in the one company, of suggestions filed under Needs approval; at least
   * 95% approved without an edit, rejections counted among the decisions; then the Executive's
   * change is the sign-off.
   */
  promotion: {
    minDecided: 200,
    minUneditedShare: 0.95,
    windowDays: 90,
    countedAutonomy: 'needs_approval',
  } satisfies PromotionRule,

  /**
   * Where an agent starts when no setting names its autonomy (PRD AI-04: shadow, then approval,
   * then automatic). The Triage agent starts in Shadow (A1): it records what it would propose and
   * never acts or fills an inbox; raising an action type to Suggest or Needs approval is an
   * Executive's choice on Admin › Agents. Every other agent starts at Suggest.
   */
  startingAutonomy: { 'agent:triage': 'shadow' },

  /**
   * The Triage agent (A1). Each value is flagged for the owner to confirm; a change moves only how
   * far the agent may go:
   * - `scoreAdjustmentMax`: the most a proposal may move a lead's rules-based score, up or down,
   *   in points (BLUEPRINT "refined within bounds by the Triage agent"); the score it gives stays
   *   between 0 and 100 as `scoreLead()` holds it;
   * - `peopleOffered` and `candidatesOffered`: the most people (fewest open leads first) and
   *   duplicate cards (surest first) one run shows the model;
   * - `maxTokens` and `totalTimeoutMs`: the answer's length and the whole call's time, every
   *   attempt included, inside the event route's minute;
   * - `promptVersion`: named on every eval run, changed with any change of the prompt.
   */
  triage: {
    scoreAdjustmentMax: 10,
    peopleOffered: 30,
    candidatesOffered: 5,
    maxTokens: 400,
    totalTimeoutMs: 40_000,
    promptVersion: 'triage-1',
  },

  /**
   * The Knowledge Vault's model work (docs/03-roadmap-appendix/phase1.md §8.4), which no agent principal does:
   * the index job reads vault files (PDFs and photos by Claude) and embeds their passages, and the
   * staff search embeds each question. Each is counted under its own name in the spend totals and
   * held against its own daily cap for the whole group, in paise: ₹500 a day for reading and
   * embedding files (reading a PDF or a photo reserves about ₹25 before it is sent, and costs a few rupees), and
   * ₹100 a day for search questions (each costs a paisa). Both caps are flagged for the owner to
   * confirm; a change moves only how much the vault may read or answer in a day.
   */
  knowledge: {
    indexName: 'knowledge:index',
    searchName: 'knowledge:search',
    indexDailyCapPaise: 50_000,
    searchDailyCapPaise: 10_000,
    /** One person's daily share of the search cap: a fifth, so one person cannot use it all up. */
    searchPersonDailyCapPaise: 2_000,
  },

  /**
   * The Playbook's model work (docs/03-roadmap-appendix/phase2.md §5.4), which no agent principal
   * does, counted under its own spend name for the whole group. Each value is flagged for the
   * owner to confirm:
   * - `conflictDistance`: approved directives of the same type whose embedding lies within this
   *   cosine distance of a draft's are its conflict candidates (0.20, workshop default);
   * - `candidatesPerCheck`: the most candidates one check labels, nearest first;
   * - `labelModel` (Haiku 5.5) labels each candidate pair, `draftModel` (Sonnet 5.5) drafts from a
   *   vault file (question 1 (a)); each at its own effort and answer length;
   * - `draftsPerFile`: the most drafts one vault file yields; `passagesPerDraft`: the most
   *   passages of the file the model reads, in order, so a call stays well inside the prompt
   *   size Haiku's and Sonnet's prices hold for;
   * - `dailyCapPaise`: ₹300 a day for the group; `personDailyCapPaise`: one person's share of it
   *   for drafting, a third;
   * - `promptVersion`: named with every change of the two prompts.
   */
  playbook: {
    spendName: 'knowledge:playbook',
    conflictDistance: 0.2,
    candidatesPerCheck: 5,
    labelModel: 'claude-haiku-5-5',
    labelEffort: 'low',
    labelMaxTokens: 2_000,
    draftModel: 'claude-sonnet-5-5',
    draftEffort: 'medium',
    draftMaxTokens: 16_000,
    draftsPerFile: 10,
    passagesPerDraft: 60,
    dailyCapPaise: 30_000,
    personDailyCapPaise: 10_000,
    promptVersion: 'playbook-1',
  },

  /**
   * Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5, §11, questions 1 and 9): Sonnet 5.5
   * with read-only lookups, counted under its own spend name for the whole group. Each value is
   * flagged for the owner to confirm:
   * - `dailyCapPaise`: ₹1,000 a day for the group; `personDailyCapPaise`: ₹50 a day a person;
   * - `effort` medium, thinking left adaptive (§9.1), `maxTokens` per call, thinking included;
   * - `maxModelCalls`: the most model calls one question makes, lookups included; the last one
   *   offers no more lookups, so the model answers with what it read;
   * - `totalTimeoutMs`: one call's time, every attempt included;
   * - `rowsPerLookup`: the most records one lookup returns; `passagesPerSearch`: the most vault
   *   passages one search returns; `directivesRead`: the most Playbook directives read;
   * - `earlierTurns`: the most earlier questions and answers of the conversation the model reads;
   * - `promptVersion`: named with every change of the prompt or the lookups.
   */
  ask: {
    spendName: 'knowledge:ask',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    maxTokens: 6_000,
    maxModelCalls: 5,
    totalTimeoutMs: 45_000,
    dailyCapPaise: 100_000,
    personDailyCapPaise: 5_000,
    rowsPerLookup: 25,
    passagesPerSearch: 8,
    directivesRead: 200,
    earlierTurns: 4,
    promptVersion: 'ask-1',
  },

  /**
   * Live voice's reply step (docs/03-roadmap-appendix/phase2.md §9.1, question 1 (a)): Sonnet 5.5,
   * with thinking off (`between_tools`, which Sonnet 5.5 accepts at effort `high` or below) at
   * effort `low`, so the first sentence comes quickly; a spoken reply is one or two sentences, so
   * `maxTokens` stays small. The voice spike's `claude-stream.ts` and the benchmark read these; V2's
   * worker takes them over, and the eval sets measure any change first.
   */
  voice: {
    model: 'claude-sonnet-5-5',
    effort: 'low',
    thinking: 'between_tools',
    maxTokens: 400,
  },
} as const;
