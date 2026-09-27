import { newId, type AuditOutcome, type AuthAuditEvent } from '@shakti/contracts';
import { auditLogs, authDb } from '@shakti/db/auth';
import { auditDevice, auditIp, redactAuthEvent, type Logger } from '@shakti/domain';
import { clientMeta, platformRequestId } from './client-address';

export interface AuthEvent {
  event: AuthAuditEvent;
  outcome: AuditOutcome;
  /** The person the event is about, when known; a failed sign-in for an unknown address has none. */
  actorId?: string | null | undefined;
  /** Better Auth's error code for a failure, never its message. */
  errorCode?: string | null | undefined;
  /** Candidate fields; only the event's allow-list is kept, and emails keep their last four. */
  fields?: Readonly<Record<string, unknown>> | undefined;
  headers?: Headers | undefined;
}

/**
 * Records a sign-in or account event in the audit trail (docs/design/backend-weeks-3-5.md §2.6,
 * §3.3) through the auth module's connection. These events are not part of a transaction that
 * could carry the row, so a failure to write one is logged and never stops the person signing in.
 */
export async function recordAuthEvent(e: AuthEvent, logger: Logger): Promise<void> {
  const client = clientMeta(e.headers);
  const actorId = e.actorId ?? null;
  try {
    await authDb()
      .insert(auditLogs)
      .values({
        id: newId(),
        entityId: null,
        actorPrincipalId: actorId,
        actorKind: actorId === null ? null : 'user',
        command: e.event,
        outcome: e.outcome,
        errorCode: e.errorCode ?? null,
        inputJson: redactAuthEvent(e.event, e.fields ?? {}),
        ip: auditIp(client.ip),
        device: auditDevice(client.device),
        requestId: platformRequestId(e.headers) ?? newId(),
      });
  } catch (error) {
    logger.log('error', 'audit.write_failed', { command: e.event, outcome: e.outcome, error });
  }
}
