import {
  DomainError,
  IntegrationReplayRequest,
  IntegrationReplayResponse,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';

/** What `app.replay_dead_letter()` answers (migration 0044); no row for an unknown event. */
interface ReplayRow {
  event_entity_id: number;
  event_type: string;
  previous_attempts: number;
  /** ISO 8601, from `to_json()`, so it parses the same on every driver. */
  dead_lettered_at: string | null;
}

/**
 * `integrations.dlq.replay` (design §4.4, API §3.7): an Executive puts one dead-lettered event
 * back in the queue with its attempts and error cleared; the publisher sends it on its next run.
 * `app_user` cannot write `outbox_events`, so the change goes through the definer function, which
 * checks `integrations.dlq.replay:all` itself and is the one change the outbox trigger allows on
 * a dead letter. An event that is not dead-lettered is left as it is, and one of a company outside
 * the request scope is not replayed.
 */
export const replayDeadLetter = defineCommand({
  name: 'integrations.dlq.replay',
  permission: 'integrations.dlq.replay',
  minScope: 'all',
  input: IntegrationReplayRequest,
  output: IntegrationReplayResponse,
  async handler(ctx, input) {
    const rows = (await ctx.tx.execute(sql`
      select event_entity_id, event_type, previous_attempts,
             to_json(was_dead_lettered_at) #>> '{}' as dead_lettered_at
        from app.replay_dead_letter(${input.eventId}::uuid)`)) as unknown as ReplayRow[];
    const row = rows[0];
    // An event of a company outside the request scope is answered as unknown; throwing rolls the
    // reset back with the rest of the transaction.
    if (!row || !ctx.entityIds.includes(row.event_entity_id)) {
      throw new DomainError('not_found', `event ${input.eventId} does not exist`, {
        reason: 'dead_letter_missing',
      });
    }
    if (row.dead_lettered_at === null) {
      throw new DomainError('conflict', `event ${input.eventId} is not dead-lettered`, {
        reason: 'not_dead_lettered',
      });
    }
    const deadLetteredAt = new Date(row.dead_lettered_at).toISOString();
    // A platform change that belongs to no one company, like the other admin commands.
    ctx.audit({
      aggregateType: 'outbox_event',
      aggregateId: input.eventId,
      entityId: null,
      before: { attempts: row.previous_attempts, deadLetteredAt },
      after: {
        attempts: 0,
        deadLetteredAt: null,
        eventType: row.event_type,
        eventEntityId: row.event_entity_id,
      },
    });
    return { eventId: input.eventId, requeued: true as const, attempts: 0 as const };
  },
});
