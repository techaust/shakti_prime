// The agents' named defaults (docs/03-roadmap-appendix/phase1.md §7.1 "Built (AI0)", the owner's decisions of
// 05-10-2026). Each one is flagged for the owner to confirm; a change is made here and nowhere
// else. Prices are kept in US dollars per million tokens, as the vendors publish them.

/**
 * Which recorded calls the Caller Co-pilot transcribes and summarises (question 8 of
 * docs/03-roadmap-appendix/phase2.md): the calls of the company's Lead Converters, every recorded
 * dial, or none.
 */
export type CopilotCoverage = 'lead_converter' | 'all' | 'none';

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
   * Executive's choice on Admin › Agents. The Caller Co-pilot starts in Shadow too (A2, design
   * §7.3): its suggestions reach no inbox until an Executive raises an action type to Needs
   * approval after reviewing its shadow report. The WhatsApp Concierge (A3) starts in Shadow as
   * well: its drafts are recorded and nothing is sent, until the Executive has read its shadow
   * report and raises it to Needs approval. Every other agent starts at Suggest.
   */
  startingAutonomy: {
    'agent:triage': 'shadow',
    'agent:copilot': 'shadow',
    'agent:concierge': 'shadow',
  },

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
   * ₹100 a day for search questions (each costs a paisa). Transcribing vault recordings (K3) is
   * counted under the index's name, inside its ₹500, and held as well to a cap of its own,
   * `transcribeDailyCapPaise`: ₹300 a day, ten hours of audio at Sarvam's published ₹30 an hour,
   * so recordings never take the whole day's reading. Each cap is flagged for the owner to
   * confirm; a change moves only how much the vault may read or answer in a day.
   */
  knowledge: {
    indexName: 'knowledge:index',
    searchName: 'knowledge:search',
    indexDailyCapPaise: 50_000,
    /** The part of the index's spend that transcribing recordings may take in a day. */
    transcribePart: 'transcribe',
    transcribeDailyCapPaise: 30_000,
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
   *   passages one search returns; `directivesScanned`: the most approved Playbook directives the
   *   Playbook lookup reads, and `directivesRead` the most it gives the model, those of its topic
   *   first, saying when more were left out;
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
    directivesScanned: 2_000,
    directivesRead: 50,
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
    /**
     * Each person's limits (question 12 (a), flagged for the owner to confirm): 30 minutes and
     * ₹200 a day, the day starting at midnight in India, and sessions of at most 15 minutes.
     * `voice.session.start` refuses a session once either day's limit is reached
     * (`voice_cap_reached`), and the worker ends one that reaches a limit while it runs.
     */
    personDailyMinutes: 30,
    personDailyCapPaise: 20_000,
    sessionMaxMinutes: 15,
    /**
     * Speech counted against the day's spend, per minute of a session: Sarvam's published
     * speech-to-text price, ₹30 an hour (as `knowledge.transcribeDailyCapPaise` counts it). Its
     * text to speech and LiveKit's minutes are not counted until the vendors' quotes give them
     * (flagged for the owner, docs/03-roadmap-appendix/phase2.md §10).
     */
    speechPaisePerMinute: 50,
  },

  // --- The Caller Co-pilot (A2, docs/03-roadmap-appendix/phase2.md §7.3) -------------------------
  /**
   * The Caller Co-pilot. Each value is flagged for the owner to confirm:
   * - `briefIntervalMinutes`: a lead gets at most one brief an hour, on assignment or on demand;
   * - `quoteNudgeDaysBefore`: the quote-expiry nudge is proposed two days before a sent quote
   *   expires (CALL-5's WhatsApp follow-up); the nurture message falls on the nurture days of
   *   `WORKSHOP_DEFAULTS.calling.nurtureCallDays`;
   * - `transcribe`: which recorded calls are transcribed and summarised (question 8 (a)): the
   *   calls of the company's Lead Converters (`lead_converter`), every recorded dial (`all`) or
   *   none, as `coverage` for every company unless `byCompany` names one by its id;
   * - `companyDailyCapPaise`: the most the Co-pilot spends a day in one company, its models and
   *   transcribing together, beside the caps an Executive sets on Admin › Agents (₹100, the
   *   building cap of design §10);
   * - `briefShareOfCap`: briefs may use at most half of the smallest daily cap that applies to the
   *   company, so call summaries always keep the other half (the lead's decision of 18-11-2026);
   * - `assignedBriefSkipHours`: an assigned lead (one at a time, or many in a reassignment or
   *   handover) is briefed only when it has had no brief for 24 hours; a person may still ask;
   * - `promptBytesEstimate`: the prompt size a run is checked with against the day's spend before
   *   it reads anything (with the answer's length and, for a summary, the longest call's
   *   transcription); the reservation of the call itself, at its true size, stays the final guard;
   * - `minModelMs`, `minTranscribeMs` and `storeMarginMs`: a run starts the model only with at
   *   least 10 seconds left of its delivery, and a transcription with at least 10 seconds left
   *   after the 5 kept to store and record it; each is bounded by what is left, so a run never
   *   outlives the event route's minute, and a run short of time stops before it spends and is
   *   delivered again;
   * - `briefModel` (Sonnet 5.5) and `summaryModel` (Haiku 5.5), question 1 (a), each at its own
   *   effort, answer length (thinking included) and `totalTimeoutMs` for the call, inside the
   *   event route's minute;
   * - `callsRead`, `messagesRead` and `directivesRead`: the most recent calls, chat messages and
   *   approved `staff` directives a brief reads; `transcriptCharsRead`: the most of a transcript a
   *   summary reads, its end kept;
   * - `maxCallMinutes`: a longer recording is not transcribed, so one call cannot take the day's
   *   cap and its transcript is made inside the event route's minute;
   * - `recordingWaitMinutes`: an answered call whose recording is not copied in yet is delivered
   *   again for this long after it ended, then left without a summary (a call placed unrecorded);
   * - `answerTtlSeconds`: how long the model's answer for an event is kept for a redelivery;
   * - `promptVersion`: named with every change of the prompts.
   */
  copilot: {
    briefIntervalMinutes: 60,
    quoteNudgeDaysBefore: 2,
    transcribe: {
      coverage: 'lead_converter' as CopilotCoverage,
      byCompany: {} as Readonly<Partial<Record<number, CopilotCoverage>>>,
    },
    companyDailyCapPaise: 10_000,
    briefShareOfCap: 0.5,
    assignedBriefSkipHours: 24,
    promptBytesEstimate: 24_000,
    minModelMs: 10_000,
    minTranscribeMs: 10_000,
    storeMarginMs: 5_000,
    briefModel: 'claude-sonnet-5-5',
    briefEffort: 'low',
    briefMaxTokens: 3_000,
    summaryModel: 'claude-haiku-5-5',
    summaryEffort: 'low',
    summaryMaxTokens: 3_000,
    totalTimeoutMs: 40_000,
    callsRead: 10,
    messagesRead: 10,
    directivesRead: 30,
    transcriptCharsRead: 18_000,
    maxCallMinutes: 15,
    recordingWaitMinutes: 5,
    answerTtlSeconds: 60 * 60,
    promptVersion: 'copilot-2',
  },

  // --- The WhatsApp Concierge (A3, docs/03-roadmap-appendix/phase2.md §7.2) ----------------------
  /**
   * The WhatsApp Concierge. Each value is flagged for the owner to confirm:
   * - `handlesNewThreads`: a chat a customer opens starts with the assistant, which drafts its
   *   replies (in Shadow, recorded only; under Needs approval, for the owner to send); people still
   *   see every chat waiting for a reply and are told of it after `replyWaitMinutes`, since nothing
   *   reaches a customer without a person;
   * - `companyDailyCapPaise`: the most the Concierge spends a day in one company, beside the caps an
   *   Executive sets on Admin › Agents (₹500 on dev and staging, design §7.2 and §10);
   * - `runsPerThreadDay`: the most runs one chat gets in a day in India; past it the run stops
   *   before the chat's messages, lead or rules are read, and the chat goes to people;
   * - `refusalsInARow`: this many answers in a row the output filter refused, or that could not be
   *   read, hand the chat to people;
   * - `callbackDaysAhead`: the furthest ahead a callback it proposes may be due, in days; a later
   *   one is refused with the callbacks outside calling hours;
   * - `model` (Sonnet 5.5, question 1 (a)) at `effort` low, thinking left adaptive (§9.1), with
   *   `maxTokens` for the answer, thinking included, and `totalTimeoutMs` for the call, inside the
   *   event route's minute;
   * - `promptBytesEstimate`: the prompt size a run is checked with against the day's spend before it
   *   reads anything (with the answer's length); the call's own reservation stays the final guard;
   * - `minModelMs`: a run starts the model only with at least 10 seconds left of its delivery, and
   *   a run short of time stops before it spends and is delivered again;
   * - `messagesRead` and `directivesRead`: the chat's last messages and the most approved
   *   `customer` directives one run reads;
   * - `answerTtlSeconds`: how long the model's answer for a message is kept for a redelivery;
   * - `promptVersion`: named with every change of the prompt.
   */
  concierge: {
    handlesNewThreads: true as boolean,
    companyDailyCapPaise: 50_000,
    runsPerThreadDay: 30,
    refusalsInARow: 3,
    callbackDaysAhead: 14,
    model: 'claude-sonnet-5-5',
    effort: 'low',
    maxTokens: 1_500,
    totalTimeoutMs: 40_000,
    promptBytesEstimate: 16_000,
    minModelMs: 10_000,
    messagesRead: 20,
    directivesRead: 30,
    answerTtlSeconds: 60 * 60,
    promptVersion: 'concierge-2',
  },
} as const;
