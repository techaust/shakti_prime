# ADR 0005 — Transactional outbox with Upstash QStash and Workflow

**Status:** Accepted · **Date:** 2026-09-26 · **Blueprint:** §3, §5, §9.3, §10 · **Architecture:** §6, §7, §11

## Context
State changes trigger work that must not run inside the request: WhatsApp messages, PDFs, notifications, embeddings, agent runs, reminders and multi-day cadences. Vercel functions are short-lived and have no resident worker process. Delivering an event before its transaction commits, or losing it after commit, would leave customers unmessaged or messaged about records that do not exist.

## Decision
A **transactional outbox** in Postgres, delivered by **Upstash QStash**, with **Upstash Workflow** for durable multi-step flows.

- Commands append to `outbox_events(id, sequence, entity_id, type, aggregate_type, aggregate_id, payload_json, created_at, published_at, attempts, last_error, dead_lettered_at)` through `ctx.emit()` in the same transaction as the write. The table is append-only for `app_user`; the delivery columns are updated only by the `outbox_publisher` role.
- A publisher claims unpublished rows with `FOR UPDATE SKIP LOCKED`, publishes them to QStash topics by event type and marks them published. It runs from a QStash schedule every 10 seconds and is nudged immediately after a command commits. Delivery is at-least-once.
- Workers are route handlers under `/api/v1/workers/*` on Vercel `bom1`. Each verifies the QStash signature with the current and next signing keys, checks the event ID in Upstash Redis for idempotency, runs a command and returns `200` on success or a retryable `5xx`.
- Multi-day flows (nurture cadences, document chasing, subsidy gate follow-ups, agent runs) are Upstash Workflows with named steps, so a restart resumes at the last completed step.
- Retries with backoff, then a dead-letter queue surfaced on the Integration Health page with replay.
- Inbound provider webhooks use the mirror pattern: verify signature → insert `webhook_inbox` → return `200` → QStash worker processes idempotently by provider event ID.
- pg_cron handles pure-SQL schedules (materialised-view refresh, retention, partition creation); QStash schedules handle jobs that call external services.

## Consequences
- An event exists if and only if its transaction committed, so no message or agent run references uncommitted data.
- At-least-once delivery means every worker is idempotent by event ID; this is a rule for all workers, not an option.
- No long-running process to operate; QStash, Workflow and Redis are managed and cost tens of dollars a month at full volume.
- Realtime broadcasts also flow through the outbox and a notify worker, so screens never refresh ahead of a durable write.
- Outbox depth and DLQ size are first-class metrics with alerts.
