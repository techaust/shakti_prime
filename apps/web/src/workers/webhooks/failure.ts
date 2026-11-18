import { IdSchema, type OutboxFailureCallback } from '@shakti/contracts';

/** The `inboxId` of the job QStash sent, from the callback's base64 copy of it. */
export function failedInboxId(callback: OutboxFailureCallback): string | undefined {
  try {
    const sent: unknown = JSON.parse(Buffer.from(callback.sourceBody, 'base64').toString('utf8'));
    if (typeof sent !== 'object' || sent === null || !('inboxId' in sent)) return undefined;
    const id = IdSchema.safeParse(sent.inboxId);
    return id.success ? id.data : undefined;
  } catch {
    return undefined;
  }
}
