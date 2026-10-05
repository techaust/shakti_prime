# ADR 0011 — Claude Haiku 4.5 and Sonnet 5 behind a provider wrapper; Voyage embeddings in pgvector

**Status:** Proposed (27-09-2026); the Phase 1 shadow-mode cost and quality measurements confirm the model choices · **Date:** 27-09-2026 · **Deciders:** Lead developer; the owner accepts after review · **Blueprint:** §1, §5, §7.8, §9, §13, §18 (risks 5, 6) · **Architecture:** §7, §11 · **Database:** §2, §6.9 · **Security:** vendors, AI threat model · **ADR:** 0005, 0010

## Context
Six agents, the Executive Knowledge Brain, Ask the Business, call summaries and live voice all call a language model, and the Knowledge Vault needs semantic search over documents that carry entity and sensitivity restrictions. AI is the largest variable cost (blueprint §13: roughly $1,800–5,100 a month with LC-only transcription), customer messages are untrusted input, and no model may see unmasked personal data or any cost figure. Calling the SDK directly from each feature would scatter budgets, retries, masking and model choice across the codebase.

## Decision
**Claude Haiku 4.5 by default and Claude Sonnet 5 where quality needs it, called only through one provider wrapper; Voyage embeddings stored in Postgres with pgvector.**

- **Provider wrapper** in `packages/domain` (no framework imports) around `@anthropic-ai/sdk`: every call names its purpose and agent, passes through PII masking, carries a timeout, bounded retries with backoff and a circuit breaker, and is held against the agent's daily spend caps (the company's and the group's), its most possible cost reserved before it is sent; a call over a cap is refused, the run is recorded as stopped at its cap, and the agent files nothing more that day. Tokens and cost are recorded on `agent_runs`.
- **Routing** per blueprint §9.3: Haiku 4.5 for triage, co-pilot summaries and extraction; Sonnet 5 for the WhatsApp Concierge, sizing and quote, orchestration, the Chief of Staff, Ask the Business and live voice. A route changes only with a passing eval run (`agent_evals`).
- **Cost controls:** prompt caching of the stable system prompt, Playbook and tool definitions; the Message Batches API for non-urgent work (nightly summaries, re-embedding, back-fills); structured outputs to avoid retries; Haiku by default.
- **Data terms:** a zero-data-retention agreement (or the vendor's shortest retention setting) with Anthropic and Voyage before any production data is sent, recorded in the vendor register and the privacy notice (SECURITY §5).
- **Embeddings:** Voyage models producing 1,024 dimensions, stored as `knowledge_chunks.embedding vector(1024)` with an HNSW index and iterative scan for filtered queries. Each chunk carries `entity_id` and `sensitivity`, and retrieval runs inside `withRequestContext()` as the asking user or agent, so RLS removes chunks the caller may not read before ranking. Embedding runs in the `/api/v1/workers/embeddings/index` worker from outbox events.
- **Guardrails stay in code:** tier prices, calculators and the tax engine are deterministic functions the model calls as tools and never re-derives; agent principals hold no cost permission; outbound customer messages pass the deterministic output filter.

## Consequences
- One place sets models, budgets, masking and retries; switching a model or adding a provider touches the wrapper and the evals, not the features.
- Vectors live beside the rows they describe, under the same RLS, with no second datastore to secure or sync; HNSW keeps queries fast at the expected size (tens of thousands of chunks).
- Changing the embedding model or dimension means re-embedding every chunk through the batch path; the column type is fixed at 1,024 until then.
- Spend caps can stop an agent mid-day; it then files nothing and people work their queues as before ([INCIDENTS §8](../runbooks/INCIDENTS.md#8-the-ai-service-is-down-or-an-agent-has-stopped)).
- Per-lead AI cost is measured in shadow mode before any agent moves to Automatic.
