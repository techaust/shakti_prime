import {
  ACTIVITY_NOTE_MAX,
  DomainError,
  newId,
  type ActivityType,
  type Principal,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';

/** A value a timeline row's payload may carry: an id, a code or a count. */
export type ActivityValue = string | number | boolean | null;

/**
 * One row of the customer timeline (docs/05-database.md §6.2, CRM-04). `entityId` defaults to the
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

/** The longest code a payload keeps. */
export const ACTIVITY_CODE_MAX = 80;
const MAX_KEYS = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * A code as the commands write it: a key, a code or a list of them (`name,gstin`), or a time
 * (`2026-10-01T04:00:00.000Z`). No spaces, no `+` and no `@`, so no name, phone number or email
 * address fits.
 */
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.:,-]*$/;

/**
 * Why a payload is refused, or undefined when it holds only ids, codes and counts: never a name,
 * an email address, a phone number or free text (the payload leaves the database with the
 * timeline, and only a note's body is free text). Commands build payloads from ids and codes
 * only, so a refusal is a command's own mistake, found by its tests.
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
    if (typeof value !== 'string') return `${key} is not an id, code or count`;
    if (UUID.test(value)) continue;
    if (value.length > ACTIVITY_CODE_MAX) return `${key} is longer than a code`;
    if (!CODE.test(value)) return `${key} is not an id, code or count`;
  }
  return undefined;
}

/** A pair of UTF-16 halves: one character to Postgres' `char_length`. */
const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

/** The length Postgres' `char_length` gives the text. */
function codePoints(text: string): number {
  return text.length - (text.match(SURROGATE_PAIR)?.length ?? 0);
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
  if (body !== undefined && (body.length === 0 || codePoints(body) > ACTIVITY_NOTE_MAX)) {
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
