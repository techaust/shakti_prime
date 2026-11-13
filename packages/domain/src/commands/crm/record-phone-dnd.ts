import { DomainError, PhoneDndDto, RecordPhoneDndInput } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from './opportunity-shared';

/**
 * `crm.phone.dnd_record` (BLUEPRINT §7.7, docs/03-roadmap-appendix/phase2.md §5.2): the platform
 * records what the DND register answered for one phone of a customer of the company, taken when a
 * dial's check had gone stale. Run as `system:workers`, which holds the platform-only
 * `crm.dnd.record` and no customer grant (ADR 0020): it writes through `app.record_phone_dnd()`
 * alone, which binds the answer to the number it was asked about and keeps a newer answer already
 * recorded. No person may mark or clear a number (`contact_phones_dnd_guard`). A phone that is not
 * a customer's of the company with that number is not found.
 */
export const recordPhoneDnd = defineCommand({
  name: 'crm.phone.dnd_record',
  permission: 'crm.dnd.record',
  minScope: 'entity',
  input: RecordPhoneDndInput,
  output: PhoneDndDto,
  auditFields: ['isDnd', 'dndCheckedAt'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const rows = (await ctx.tx.execute(
      sql`select is_dnd, dnd_checked_at
            from app.record_phone_dnd(${input.contactPhoneId}::uuid, ${input.e164},
                                      ${input.onDnd}, ${input.checkedAt}::timestamptz)`,
    )) as unknown as { is_dnd: boolean; dnd_checked_at: Date | string | null }[];
    const [row] = rows;
    if (!row) {
      throw new DomainError('not_found', `phone ${input.contactPhoneId} is not visible`, {
        reason: 'contact_missing',
      });
    }
    const checkedAt =
      row.dnd_checked_at === null ? null : new Date(row.dnd_checked_at).toISOString();
    ctx.audit({
      aggregateType: 'contact_phone',
      aggregateId: input.contactPhoneId,
      entityId: input.entityId,
      after: { isDnd: row.is_dnd, dndCheckedAt: checkedAt },
    });
    return { contactPhoneId: input.contactPhoneId, isDnd: row.is_dnd, dndCheckedAt: checkedAt };
  },
});
