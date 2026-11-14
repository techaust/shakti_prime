import {
  DomainError,
  LEAD_QUALIFICATION_FACTS,
  LeadQualificationDto,
  SetLeadQualificationInput,
  type LeadQualificationFact,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { lockOpportunity, requireEntity } from './opportunity-shared';

const lq = schema.leadQualifications;
type QualificationRow = typeof lq.$inferSelect;
type Facts = Record<LeadQualificationFact, number | string | null>;

/** The facts as numbers and text, from the row's numeric columns. */
function factsOf(row: QualificationRow | undefined): Facts {
  const num = (v: string | number | null | undefined): number | null =>
    v === null || v === undefined ? null : Number(v);
  return {
    pumpDepthFt: row?.pumpDepthFt ?? null,
    requiredHp: num(row?.requiredHp),
    monthlyBillRupees: num(row?.monthlyBillRupees),
    roofAreaSqFt: row?.roofAreaSqFt ?? null,
    sanctionedLoadKw: num(row?.sanctionedLoadKw),
    discomConsumerNo: row?.discomConsumerNo ?? null,
  };
}

/** A lead's qualification facts as the card shows them; all null when none is recorded. */
export function toLeadQualificationDto(
  lead: { opportunityId: string; entityId: number },
  row: QualificationRow | undefined,
): LeadQualificationDto {
  return LeadQualificationDto.parse({
    ...lead,
    ...factsOf(row),
    updatedAt: row?.updatedAt.toISOString() ?? null,
  });
}

/** The lead's facts as the caller reads them, if any are recorded. */
export async function readQualification(
  ctx: Pick<CommandContext, 'tx'>,
  opportunityId: string,
): Promise<QualificationRow | undefined> {
  const [row] = await ctx.tx.select().from(lq).where(eq(lq.opportunityId, opportunityId)).limit(1);
  return row;
}

/**
 * `crm.lead.qualification.set` (docs/03-roadmap-appendix/phase2.md §6.2): the qualification card
 * on the lead sheet records the facts a lead carries (pump depth, the power needed, the monthly
 * bill, the roof area, the sanctioned load, the DISCOM consumer number), each of which a stage may
 * require. Whoever may write the lead sets them (the policies of `lead_qualifications`); a fact left
 * out stays, `null` clears it. Agents holding `crm.lead.write` may propose them later, so the
 * command is not for people only.
 */
export const setLeadQualification = defineCommand({
  name: 'crm.lead.qualification.set',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: SetLeadQualificationInput,
  output: LeadQualificationDto,
  auditFields: [...LEAD_QUALIFICATION_FACTS],
  unmaskedFields: [
    // A DISCOM consumer number is a long number by design.
    'facts.discomConsumerNo',
  ],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    // The lead, locked: one the caller cannot read, or of another company, is not found.
    const lead = await lockOpportunity(ctx, input);
    const current = await readQualification(ctx, lead.id);
    const before = factsOf(current);
    const changed = LEAD_QUALIFICATION_FACTS.filter(
      (f) => input.facts[f] !== undefined && input.facts[f] !== before[f],
    );
    const ids = { opportunityId: lead.id, entityId: lead.entityId };
    if (changed.length === 0) return toLeadQualificationDto(ids, current);

    const values = {
      pumpDepthFt: input.facts.pumpDepthFt,
      requiredHp:
        input.facts.requiredHp === undefined ? undefined : numeric(input.facts.requiredHp),
      monthlyBillRupees:
        input.facts.monthlyBillRupees === undefined
          ? undefined
          : numeric(input.facts.monthlyBillRupees),
      roofAreaSqFt: input.facts.roofAreaSqFt,
      sanctionedLoadKw:
        input.facts.sanctionedLoadKw === undefined
          ? undefined
          : numeric(input.facts.sanctionedLoadKw),
      discomConsumerNo: input.facts.discomConsumerNo,
    };
    const set = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== undefined),
    ) as Partial<typeof lq.$inferInsert>;
    // Under the policies: the insert and the update both ask for crm.lead.write over the lead.
    const [row] = await ctx.tx
      .insert(lq)
      .values({ ...ids, ...set, updatedBy: ctx.principal.id })
      .onConflictDoUpdate({
        target: lq.opportunityId,
        set: { ...set, updatedBy: ctx.principal.id },
      })
      .returning();
    if (!row) {
      throw new DomainError('forbidden', `lead ${lead.id} is outside the caller's write scope`);
    }
    const after = factsOf(row);
    ctx.audit({
      aggregateType: 'opportunity',
      aggregateId: lead.id,
      entityId: lead.entityId,
      before: Object.fromEntries(changed.map((f) => [f, before[f]])),
      after: Object.fromEntries(changed.map((f) => [f, after[f]])),
    });
    return toLeadQualificationDto(ids, row);
  },
});

/** A number as the numeric columns take it; null clears. */
function numeric(value: number | null): string | null {
  return value === null ? null : String(value);
}
