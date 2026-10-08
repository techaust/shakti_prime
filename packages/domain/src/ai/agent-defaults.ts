// The agents' named defaults (docs/design/phase1.md §7.1 "Built (AI0)", the owner's decisions of
// 05-10-2026). Each one is flagged for the owner to confirm; a change is made here and nowhere
// else. Prices are kept in US dollars per million tokens, as the vendors publish them.

/** One model's published price, in US dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Input read from the prompt cache. */
  cacheRead: number;
  /** Input written to the prompt cache. */
  cacheWrite: number;
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
   * The models an agent may call and their prices, as published on `pricesCheckedOn`; only the
   * models the design names (Haiku 4.5 and the Voyage embeddings). Flagged for the owner to check
   * against the vendors' price pages; a call naming any other model is refused.
   */
  pricesCheckedOn: '2026-10-05',
  modelPrices: {
    'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
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
   * The Knowledge Vault's model work (docs/design/phase1.md §8.4), which no agent principal does:
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
} as const;
