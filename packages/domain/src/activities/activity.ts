import {
  ACTIVITY_NOTE_MAX,
  DomainError,
  newId,
  type ActivityType,
  type Principal,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';

/** A value a timeline row's payload may carry: an id, a code, a count or a short label. */
export type ActivityValue = string | number | boolean | null;

/**
 * One row of the customer timeline (docs/DATABASE.md §6.2, CRM-04). `entityId` defaults to the
 * request's single company; `opportunityId` is left out for a change to the customer itself.
 */
export interface ActivityRecord {
  type: ActivityType;
  accountId: string;
  opportunityId?: string | null;
  entityId?: number;
  payload?: Readonly<Record<string, ActivityValue>>;
  /** A note's text; only a `note` has one. */
  body?: string;
}

/** The longest label a payload keeps. */
export const ACTIVITY_LABEL_MAX = 80;
const MAX_KEYS = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Seven digits in a row outside an id read as a phone number, which a payload never holds. */
const PHONE_LIKE = /\d{7,}/;

/**
 * Why a payload is refused, or undefined when it holds only ids, codes, counts and short labels:
 * never an email address, a phone number or free text (the payload leaves the database with the
 * timeline, and only a note's body is free text).
 */
export function payloadProblem(payload: Readonly<Record<string, unknown>>): string | undefined {
  const entries = Object.entries(payload);
  if (entries.length > MAX_KEYS) return 'too many fields';
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key)) return `field name ${key}`;
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return `${key} is not a finite number`;
      continue;
    }
    if (typeof value !== 'string') return `${key} is not an id, code, count or label`;
    if (UUID.test(value)) continue;
    if (value.length > ACTIVITY_LABEL_MAX) return `${key} is longer than a label`;
    if (value.includes('@')) return `${key} looks like an email address`;
    if (PHONE_LIKE.test(value)) return `${key} looks like a phone number`;
  }
  return undefined;
}

/** The row `activities` takes for `record`, written as `principal` (the insert policy's actor). */
export function activityRow(
  principal: Pick<Principal, 'id'>,
  activeEntityId: number | undefined,
  record: ActivityRecord,
): typeof schema.activities.$inferInsert {
  const entityId = record.entityId ?? activeEntityId;
  if (entityId === undefined) {
    throw new DomainError('internal', `activity ${record.type} names no company`);
  }
  const payload = record.payload ?? {};
  const problem = payloadProblem(payload);
  if (problem !== undefined) {
    throw new DomainError('internal', `activity ${record.type} payload refused: ${problem}`);
  }
  const isNote = record.type === 'note';
  const body = record.body;
  if (isNote !== (body !== undefined)) {
    throw new DomainError('internal', 'only a note has text, and a note always has it');
  }
  if (body !== undefined && (body.length === 0 || [...body].length > ACTIVITY_NOTE_MAX)) {
    // The command's input caps a note first; this keeps the check that the table makes.
    throw new DomainError(
      'internal',
      `a note is between 1 and ${String(ACTIVITY_NOTE_MAX)} characters`,
    );
  }
  return {
    id: newId(),
    entityId,
    opportunityId: record.opportunityId ?? null,
    accountId: record.accountId,
    type: record.type,
    actorPrincipalId: principal.id,
    payloadJson: payload,
    body: body ?? null,
  };
}

/** Writes timeline rows in the caller's transaction, under the insert policy (no `returning`). */
export async function writeActivities(
  tx: RequestTx,
  rows: readonly (typeof schema.activities.$inferInsert)[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(schema.activities).values([...rows]);
}
