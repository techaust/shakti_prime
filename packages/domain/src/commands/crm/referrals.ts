import {
  CommissionRuleDto,
  DomainError,
  newId,
  ReferralPartnerDto,
  SetCommissionRuleInput,
  SetReferralPartnerInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { assertConfigScope } from './config-scope';

const rp = schema.referralPartners;
const cr = schema.commissionRules;

/**
 * `crm.referral_partner.set` (CRM-09): gives a referral-partner customer its code, changes it, or
 * stops it being accepted. A partner is a customer of type `referral_partner` (ADR 0008); whoever
 * may update that customer may set its code. Codes are unique whatever their case.
 */
export const setReferralPartner = defineCommand({
  name: 'crm.referral_partner.set',
  permission: 'crm.account.write',
  minScope: 'entity',
  input: SetReferralPartnerInput,
  output: ReferralPartnerDto,
  auditFields: ['code', 'isActive'],
  constraintReasons: { referral_partners_code_unique: 'referral_code_taken' },
  async handler(ctx, input) {
    const a = schema.accounts;
    const [account] = await ctx.tx
      .select({ id: a.id, type: a.type })
      .from(a)
      .where(and(eq(a.id, input.accountId), isNull(a.archivedAt)))
      .limit(1);
    if (!account) {
      throw new DomainError('not_found', `account ${input.accountId} is not visible`, {
        reason: 'account_missing',
      });
    }
    if (account.type !== 'referral_partner') {
      throw new DomainError('validation_failed', 'only a referral partner customer takes a code', {
        reason: 'referral_account_type',
      });
    }
    const code = input.code.toUpperCase();
    const [existing] = await ctx.tx
      .select()
      .from(rp)
      .where(eq(rp.accountId, account.id))
      .limit(1)
      .for('update');
    const actor = ctx.principal.id;
    const [row] = existing
      ? await ctx.tx
          .update(rp)
          .set({ code, isActive: input.isActive, updatedBy: actor })
          .where(eq(rp.accountId, account.id))
          .returning()
      : await ctx.tx
          .insert(rp)
          .values({ accountId: account.id, code, isActive: input.isActive, createdBy: actor })
          .returning();
    if (!row) {
      throw new DomainError(
        'forbidden',
        `account ${account.id} is outside the caller's write scope`,
      );
    }
    ctx.audit({
      aggregateType: 'referral_partner',
      aggregateId: account.id,
      entityId: null,
      before: existing ? { code: existing.code, isActive: existing.isActive } : null,
      after: { code: row.code, isActive: row.isActive },
    });
    return ReferralPartnerDto.parse({
      accountId: row.accountId,
      code: row.code,
      isActive: row.isActive,
    });
  },
});

/**
 * `crm.commission_rule.set` (workshop CRM-5): a partner's commission rule, or the group default,
 * from a date. Commission rules carry no company, so only a request acting for every company may
 * set one (the shared set-up rule). The rule that was open-ended until then ends where the new one
 * starts; any other overlap is refused by the table's exclusion constraint. No rule exists until
 * the workshop answers; accruals are made when an order is confirmed.
 */
export const setCommissionRule = defineCommand({
  name: 'crm.commission_rule.set',
  permission: 'crm.config.write',
  minScope: 'all',
  input: SetCommissionRuleInput,
  output: CommissionRuleDto,
  auditFields: ['basis', 'amount', 'effectiveFrom', 'effectiveTo'],
  constraintReasons: { commission_rules_period_excl: 'commission_rule_overlap' },
  async handler(ctx, input) {
    await assertConfigScope(ctx, null);
    if (input.partnerId !== null) {
      const [partner] = await ctx.tx
        .select({ id: rp.accountId })
        .from(rp)
        .where(eq(rp.accountId, input.partnerId))
        .limit(1);
      if (!partner) {
        throw new DomainError('not_found', `partner ${input.partnerId} is not visible`, {
          reason: 'commission_partner_missing',
        });
      }
    }
    const samePartner =
      input.partnerId === null ? isNull(cr.partnerId) : eq(cr.partnerId, input.partnerId);
    const actor = ctx.principal.id;
    const [open] = await ctx.tx
      .select({ id: cr.id })
      .from(cr)
      .where(
        and(
          samePartner,
          isNull(cr.archivedAt),
          isNull(cr.effectiveTo),
          lt(cr.effectiveFrom, input.effectiveFrom),
        ),
      )
      .limit(1)
      .for('update');
    if (open) {
      await ctx.tx
        .update(cr)
        .set({ effectiveTo: input.effectiveFrom, updatedBy: actor })
        .where(eq(cr.id, open.id));
      ctx.audit({
        aggregateType: 'commission_rule',
        aggregateId: open.id,
        entityId: null,
        before: { effectiveTo: null },
        after: { effectiveTo: input.effectiveFrom },
      });
    }
    const [row] = await ctx.tx
      .insert(cr)
      .values({
        id: newId(),
        partnerId: input.partnerId,
        basis: input.basis,
        amount: input.amount,
        trigger: 'order_confirmed',
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        createdBy: actor,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'commission rule insert returned no row');
    const dto = CommissionRuleDto.parse({
      id: row.id,
      partnerId: row.partnerId,
      basis: row.basis,
      amount: row.amount,
      trigger: row.trigger,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    });
    ctx.audit({
      aggregateType: 'commission_rule',
      aggregateId: row.id,
      entityId: null,
      before: null,
      after: {
        partnerId: dto.partnerId,
        basis: dto.basis,
        amount: dto.amount,
        effectiveFrom: dto.effectiveFrom,
        effectiveTo: dto.effectiveTo,
      },
    });
    return dto;
  },
});

/** The partner a referral code names, for a caller who may write leads; undefined if none. */
export async function partnerForCode(
  tx: CommandContext['tx'],
  code: string,
): Promise<string | undefined> {
  const rows = (await tx.execute(
    sql`select app.referral_partner_for_code(${code}) as id`,
  )) as unknown as { id: string | null }[];
  return rows[0]?.id ?? undefined;
}
