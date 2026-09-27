import { schema, type RequestTx } from '@shakti/db';
import { and, eq } from 'drizzle-orm';

/** What a claim found: a key used for the first time, or the call that used it before. */
export type IdempotencyClaim =
  { kind: 'fresh' } | { kind: 'seen'; command: string; inputHash: string; response: unknown };

export interface IdempotencyClaimRequest {
  principalId: string;
  key: string;
  command: string;
  inputHash: string;
}

/**
 * Where idempotency keys live (docs/design/backend-weeks-3-5.md §5). Both calls run in the
 * command's transaction: the claim holds the key while the command runs, so a concurrent repeat
 * waits and then sees the committed answer, and a rolled-back call leaves no key behind.
 */
export interface IdempotencyStore {
  claim(tx: RequestTx, request: IdempotencyClaimRequest): Promise<IdempotencyClaim>;
  complete(tx: RequestTx, principalId: string, key: string, response: unknown): Promise<void>;
}

/** The production store: `idempotency_keys` through the caller's own connection and policies. */
export const databaseIdempotencyStore: IdempotencyStore = {
  async claim(tx, request) {
    const k = schema.idempotencyKeys;
    // A repeat of a call still running waits here on the row, until that call commits or not.
    const claimed = await tx
      .insert(k)
      .values({
        principalId: request.principalId,
        key: request.key,
        command: request.command,
        inputHash: request.inputHash,
      })
      .onConflictDoNothing()
      .returning({ key: k.key });
    if (claimed.length > 0) return { kind: 'fresh' };
    const [seen] = await tx
      .select({ command: k.command, inputHash: k.inputHash, response: k.responseJson })
      .from(k)
      .where(and(eq(k.principalId, request.principalId), eq(k.key, request.key)))
      .limit(1);
    if (seen === undefined) throw new Error('an idempotency key conflicted but cannot be read');
    return { kind: 'seen', ...seen };
  },
  async complete(tx, principalId, key, response) {
    const k = schema.idempotencyKeys;
    await tx
      .update(k)
      .set({ responseJson: response })
      .where(and(eq(k.principalId, principalId), eq(k.key, key)));
  },
};

/** For pure tests: one map, no transactions. */
export function memoryIdempotencyStore(): IdempotencyStore & {
  rows: Map<string, { command: string; inputHash: string; response: unknown }>;
} {
  const rows = new Map<string, { command: string; inputHash: string; response: unknown }>();
  const id = (principalId: string, key: string) => `${principalId}:${key}`;
  return {
    rows,
    claim(_tx, request) {
      const seen = rows.get(id(request.principalId, request.key));
      if (seen !== undefined) return Promise.resolve({ kind: 'seen', ...seen });
      rows.set(id(request.principalId, request.key), {
        command: request.command,
        inputHash: request.inputHash,
        response: null,
      });
      return Promise.resolve({ kind: 'fresh' });
    },
    complete(_tx, principalId, key, response) {
      const row = rows.get(id(principalId, key));
      if (row !== undefined) row.response = response;
      return Promise.resolve();
    },
  };
}
