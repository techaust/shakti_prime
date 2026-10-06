import { newId, type AuditOutcome, type PrincipalKind } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { isIP } from 'node:net';

/** Where the request came from, as the web or API layer saw it. */
export interface ClientMeta {
  ip?: string | null;
  device?: string | null;
}

/** One audit row, already redacted (docs/03-roadmap-appendix/backend-weeks-3-5.md §3.1). */
export interface AuditRecord {
  command: string;
  outcome: AuditOutcome;
  entityId: number | null;
  actorPrincipalId: string;
  actorKind: PrincipalKind;
  onBehalfOfUserId: string | null;
  aggregateType: string | null;
  aggregateId: string | null;
  errorCode: string | null;
  input: unknown;
  before: unknown;
  after: unknown;
  client: ClientMeta;
  requestId: string;
}

/**
 * Writes audit rows inside the transaction it is given, so a row commits with the change it
 * records or not at all. The runner requires one (review 3); tests pass an in-memory sink.
 */
export interface AuditSink {
  write(tx: RequestTx, records: readonly AuditRecord[]): Promise<void>;
}

export const DEVICE_MAX_LENGTH = 256;

/** An address Postgres will take as `inet`, or nothing; a malformed header must not fail a command. */
export function auditIp(ip: string | null | undefined): string | null {
  return typeof ip === 'string' && isIP(ip) !== 0 ? ip : null;
}

export function auditDevice(device: string | null | undefined): string | null {
  if (typeof device !== 'string' || device === '') return null;
  return device.slice(0, DEVICE_MAX_LENGTH);
}

/** The production sink: `audit_logs` through the caller's own connection and policies. */
export const databaseAuditSink: AuditSink = {
  async write(tx, records) {
    if (records.length === 0) return;
    await tx.insert(schema.auditLogs).values(
      records.map((r) => ({
        id: newId(),
        entityId: r.entityId,
        actorPrincipalId: r.actorPrincipalId,
        actorKind: r.actorKind,
        onBehalfOfUserId: r.onBehalfOfUserId,
        command: r.command,
        aggregateType: r.aggregateType,
        aggregateId: r.aggregateId,
        outcome: r.outcome,
        errorCode: r.errorCode,
        inputJson: r.input,
        beforeJson: r.before,
        afterJson: r.after,
        ip: auditIp(r.client.ip),
        device: auditDevice(r.client.device),
        requestId: r.requestId,
      })),
    );
  },
};

/** For pure tests: keeps what it is given. */
export function memoryAuditSink(): AuditSink & { records: AuditRecord[] } {
  const records: AuditRecord[] = [];
  return {
    records,
    write(_tx, batch) {
      records.push(...batch);
      return Promise.resolve();
    },
  };
}
