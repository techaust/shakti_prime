import {
  DomainError,
  ExpireWhatsAppMediaDto,
  ExpireWhatsAppMediaInput,
  RecordWhatsAppMediaOrphansDto,
  RecordWhatsAppMediaOrphansInput,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { assertEntityInScope } from '../imports/shared';

// W2 WhatsApp media retention (docs/03-roadmap-appendix/phase2.md §11, BLUEPRINT §7.9). Both
// commands run as `system:workers` with the platform-only `messaging.media.expire`, which no
// person's role or agent holds (ADR 0020), and write only through their definers, which check
// the grant and the company themselves; neither reads a message or a customer row.

const uuidArray = (ids: readonly string[]) => `{${ids.join(',')}}`;

/**
 * `messaging.media.expire`: one batch of one company's WhatsApp files whose bytes the media
 * retention job (`apps/web/src/workers/whatsapp-media-retention.ts`) deleted from the store.
 * `app.whatsapp_expire_media()` checks each message again under lock, so only a media message
 * older than `WORKSHOP_DEFAULTS.retention.whatsappMediaYears` whose WhatsApp file no other record
 * uses has its file marked deleted (the row kept) and its summary written (type, name, size, the
 * checks' verdict); the message keeps its text. The batch is one row of `retention_runs`, with
 * the files the store refused as its error. One audit row per removed file, with no customer
 * value; no event is sent, since nothing waits on it.
 */
export const expireWhatsAppMedia = defineCommand({
  name: 'messaging.media.expire',
  permission: 'messaging.media.expire',
  minScope: 'entity',
  input: ExpireWhatsAppMediaInput,
  output: ExpireWhatsAppMediaDto,
  auditFields: ['deletedAt'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const [row] = (await ctx.tx.execute(sql`
      select app.whatsapp_expire_media(${input.entityId}::smallint,
                                       ${WORKSHOP_DEFAULTS.retention.whatsappMediaYears}::integer,
                                       ${uuidArray(input.messageIds)}::uuid[],
                                       ${input.failed}::integer) as result`)) as unknown as {
      result: { removed: { messageId: string; fileId: string }[]; inUse: number } | null;
    }[];
    if (row?.result == null) {
      throw new DomainError('internal', 'the media removal answered nothing');
    }
    const at = ctx.now.toISOString();
    for (const removed of row.result.removed) {
      ctx.audit({
        aggregateType: 'file',
        aggregateId: removed.fileId,
        entityId: input.entityId,
        before: { deletedAt: null },
        after: { deletedAt: at },
      });
    }
    return {
      entityId: input.entityId,
      removed: row.result.removed,
      inUse: row.result.inUse,
    };
  },
});

/**
 * `messaging.media.record_orphans`: the record of one company's sweep of keys under its WhatsApp
 * folder that no file names (an original a stopped try stored and never attached, or one the
 * checks left behind), which the job deleted from the store: one row of `retention_runs`
 * through `app.whatsapp_media_orphans_record()`. Nothing else changes, so nothing is audited.
 */
export const recordWhatsAppMediaOrphans = defineCommand({
  name: 'messaging.media.record_orphans',
  permission: 'messaging.media.expire',
  minScope: 'entity',
  input: RecordWhatsAppMediaOrphansInput,
  output: RecordWhatsAppMediaOrphansDto,
  auditFields: [],
  auditWhen: 'changed',
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    await ctx.tx.execute(sql`
      select app.whatsapp_media_orphans_record(${input.entityId}::smallint,
                                               ${input.startedAt}::timestamptz,
                                               ${input.removed}::integer,
                                               ${input.failed}::integer)`);
    return { entityId: input.entityId, removed: input.removed, failed: input.failed };
  },
});
