import { DomainError, newId, RouteEnquiryInput, RoutedEnquiryDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { transition } from '../../state-machines/define-machine';
import { inboxItemMachine } from '../../state-machines/machines/inbox-item';
import { requireEntity } from './opportunity-shared';

interface Holder {
  account_id: string;
  owner_id: string;
  team_id: string | null;
  owner_name: string;
}

/**
 * `crm.enquiry.route` (PRD RPT-04 criterion 2, docs/03-roadmap-appendix/phase1.md §8.1): a lead refused as
 * `customer_held_by_colleague` becomes routed work for the colleague who looks after the customer
 * in the company. The refusal rolls its own transaction back, so the lead and walk-in forms' server
 * action runs this command in a fresh one: it finds the colleague (`app.enquiry_holder()`, for the
 * known customer or the live customer with the typed number), files an `inbox_items` row of kind
 * `routed_work` on the customer for them and their team, with the enquiry's interest (the
 * pipeline's segment) and its note, and sends `crm.enquiry.routed`, whose notice tells them. It
 * needs what `crm.lead.create` needs in the company, and is for people only. The caller learns the
 * colleague's name and nothing about the customer.
 */
export const routeEnquiry = defineCommand({
  name: 'crm.enquiry.route',
  permission: 'crm.lead.write',
  minScope: 'own',
  alsoRequires: [{ permission: 'crm.account.write', minScope: 'own' }],
  peopleOnly: true,
  input: RouteEnquiryInput,
  output: RoutedEnquiryDto,
  auditFields: ['segment', 'note'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const p = schema.pipelines;
    const [pipeline] = await ctx.tx
      .select({ segment: p.segment })
      .from(p)
      .where(
        and(
          eq(p.key, input.pipelineKey),
          eq(p.isActive, true),
          or(isNull(p.entityId), eq(p.entityId, input.entityId)),
        ),
      )
      .limit(1);
    if (!pipeline) {
      throw new DomainError('validation_failed', `pipeline ${input.pipelineKey} is not offered`, {
        reason: 'lead_pipeline_missing',
      });
    }
    const holders = (await ctx.tx.execute(
      sql`select account_id, owner_id, team_id, owner_name
            from app.enquiry_holder(${input.entityId}::smallint,
                                    ${input.existingAccountId ?? null}::uuid,
                                    ${input.phone ?? null}::text)`,
    )) as unknown as Holder[];
    const holder = holders[0];
    if (holder === undefined) {
      throw new DomainError('not_found', 'no colleague looks after this customer', {
        reason: 'enquiry_holder_missing',
      });
    }
    transition(inboxItemMachine, { state: null }, 'route', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: {},
    });
    const itemId = newId();
    const segment = pipeline.segment as RoutedEnquiryDto['segment'];
    // No `returning`: the item is the colleague's, which the caller does not read.
    await ctx.tx.insert(schema.inboxItems).values({
      id: itemId,
      entityId: input.entityId,
      kind: 'routed_work',
      assigneeId: holder.owner_id,
      teamId: holder.team_id,
      subjectType: 'account',
      subjectId: holder.account_id,
      state: 'open',
      segment,
      note: input.note ?? null,
      createdBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'inbox_item',
      aggregateId: itemId,
      entityId: input.entityId,
      before: null,
      after: { segment, note: input.note ?? null },
    });
    ctx.emit({
      type: 'crm.enquiry.routed',
      entityId: input.entityId,
      aggregateType: 'inbox_item',
      aggregateId: itemId,
      payload: { assigneeId: holder.owner_id, accountId: holder.account_id },
    });
    return { outcome: 'routed' as const, itemId, colleagueName: holder.owner_name, segment };
  },
});
