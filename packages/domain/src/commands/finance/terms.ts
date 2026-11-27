import {
  DomainError,
  MilestoneTemplateDto,
  newId,
  PublishMilestoneTemplateInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, desc, eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { readMilestoneTemplates } from '../../queries/finance/finance-dto';
import { requireEntity } from '../crm/opportunity-shared';

/**
 * `finance.terms.publish` (docs/03-roadmap-appendix/phase5.md §6.1, question 6 (a)): an Executive
 * publishes a new version of a company's payment terms for a segment in Settings › Payment terms.
 * The newest version is current: an order confirmed from now on is planned from it, and an order
 * already planned keeps its milestones. A version is never changed. People only.
 */
export const publishPaymentTerms = defineCommand({
  name: 'finance.terms.publish',
  permission: 'finance.payment.write',
  minScope: 'all',
  peopleOnly: true,
  input: PublishMilestoneTemplateInput,
  output: MilestoneTemplateDto,
  auditFields: ['segment', 'version', 'stepCount'],
  constraintReasons: { payment_milestone_templates_version_unique: 'concurrent_change' },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const t = schema.paymentMilestoneTemplates;
    const [current] = await ctx.tx
      .select({ version: t.version })
      .from(t)
      .where(and(eq(t.entityId, input.entityId), eq(t.segment, input.segment)))
      .orderBy(desc(t.version))
      .limit(1);
    const version = (current?.version ?? 0) + 1;
    const id = newId();
    await ctx.tx.insert(t).values({
      id,
      entityId: input.entityId,
      segment: input.segment,
      version,
      stepsJson: input.steps,
      createdBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'payment_terms',
      aggregateId: id,
      entityId: input.entityId,
      before: current === undefined ? undefined : { version: current.version },
      after: { segment: input.segment, version, stepCount: input.steps.length },
    });
    ctx.emit({
      type: 'finance.terms.published',
      entityId: input.entityId,
      aggregateType: 'payment_terms',
      aggregateId: id,
      payload: { segment: input.segment, version },
    });
    const published = (await readMilestoneTemplates(ctx, input.entityId)).find((x) => x.id === id);
    if (!published) throw new DomainError('internal', `terms ${id} were not read back`);
    return published;
  },
});
