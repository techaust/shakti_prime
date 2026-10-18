import {
  CommissionRuleDto,
  CreateReferralPartnerInput,
  DomainError,
  ReferralPartnerRowDto,
  newId,
  ReferralPartnerDto,
  SetCommissionRuleInput,
  SetReferralPartnerInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { commitAccountBatch } from '../../imports/commit-accounts';
import { assertConfigScope } from './config-scope';
import { lockNewNumber } from './create-lead';
import { requireEntity } from './opportunity-shared';

const rp = schema.referralPartners;
const cr = schema.commissionRules;

/**
 * `crm.referral_partner.set` (CRM-09): gives a referral-partner customer its code, changes it, or
 * stops it being accepted. A partner is a customer of type `referral_partner` (ADR 0008) related to
 * a company of the request; a code decides who earns commission, so only an Executive sets it
 * (`crm.config.write`). Codes are unique whatever their case. The audit row carries the company
 * when the partner belongs to exactly one of the request's companies.
 */
export const setReferralPartner = defineCommand({
  name: 'crm.referral_partner.set',
  permission: 'crm.config.write',
  minScope: 'all',
  input: SetReferralPartnerInput,
  output: ReferralPartnerDto,
  auditFields: ['code', 'codeActive'],
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
    const ae = schema.accountEntities;
    const companies = await ctx.tx
      .select({ entityId: ae.entityId })
      .from(ae)
      .where(and(eq(ae.accountId, account.id), inArray(ae.entityId, [...ctx.entityIds])));
    ctx.audit({
      aggregateType: 'referral_partner',
      aggregateId: account.id,
      entityId: companies.length === 1 ? (companies[0]?.entityId ?? null) : null,
      before: existing ? { code: existing.code, codeActive: existing.isActive } : null,
      after: { code: row.code, codeActive: row.isActive },
    });
    return ReferralPartnerDto.parse({
      accountId: row.accountId,
      code: row.code,
      isActive: row.isActive,
    });
  },
});

/**
 * `crm.referral_partner.create` (the owner's decision of 05-10-2026): an Executive adds a referral
 * partner from Settings › Pipelines with no lead: a customer of the type Referral partner, known to
 * one company of the request and looked after there by the Executive, with its person, phone and
 * business name. The customer is written by the customer import's own writer
 * (`commitAccountBatch()`, the same rows, in the same order, under the same policies), so a partner
 * is made as any customer is. A number that is already a customer's is refused
 * (`referral_partner_phone_known`): that customer becomes a partner by its type on Account 360. A
 * code given at once is set through `crm.referral_partner.set`, in the same transaction.
 */
export const createReferralPartner = defineCommand({
  name: 'crm.referral_partner.create',
  permission: 'crm.config.write',
  minScope: 'all',
  alsoRequires: [{ permission: 'crm.account.write', minScope: 'own' }],
  peopleOnly: true,
  input: CreateReferralPartnerInput,
  output: ReferralPartnerRowDto,
  auditFields: ['accountType'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    // The lead form's number lock, taken before the lookup, so a lead or another partner saved
    // with the same number at the same moment waits for this one and then finds it.
    await lockNewNumber(ctx.tx, input.phone, input.entityId);
    // A number left only on an archived contact is free, as `app.lead_phone_status()` reads it.
    const known = (await ctx.tx.execute(sql`
      select 1 from contact_phones cp
        join contacts c on c.id = cp.contact_id and c.archived_at is null
        join account_contacts ac on ac.contact_id = cp.contact_id
        join accounts a on a.id = ac.account_id and a.archived_at is null
       where cp.e164 = ${input.phone}
       limit 1`)) as unknown as unknown[];
    if (known.length > 0) {
      throw new DomainError('validation_failed', 'the number is already a customer', {
        reason: 'referral_partner_phone_known',
        // So the form shows the sentence under its phone box.
        issues: [{ path: 'phone', message: 'referral_partner_phone_known' }],
      });
    }
    const name = input.businessName ?? input.name;
    const made = await commitAccountBatch(ctx, ctx.tx, [
      {
        rowNo: 1,
        input: {
          entityIds: [input.entityId],
          contact: { name: input.name, phone: input.phone },
          account: { type: 'referral_partner', name },
        },
      },
    ]);
    const account = made.created[0];
    if (made.refused.length > 0 || account === undefined) {
      throw new DomainError('conflict', 'a colleague looks after this customer', {
        reason: 'customer_held_by_colleague',
      });
    }
    ctx.audit({
      aggregateType: 'account',
      aggregateId: account.id,
      entityId: input.entityId,
      before: null,
      after: { accountType: 'referral_partner' },
    });
    if (input.code === undefined) {
      return { accountId: account.id, name, code: null, isActive: false };
    }
    const coded = await ctx.run(setReferralPartner, {
      accountId: account.id,
      code: input.code,
      isActive: true,
    });
    return { accountId: account.id, name, code: coded.code, isActive: coded.isActive };
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

/**
 * The partner a referral code names for a lead of `entityId`: an active partner whose customer is
 * live and related to that company. For a caller who may write leads; undefined if none.
 */
export async function partnerForCode(
  tx: CommandContext['tx'],
  code: string,
  entityId: number,
): Promise<string | undefined> {
  const rows = (await tx.execute(
    sql`select app.referral_partner_for_code(${code}, ${entityId}::smallint) as id`,
  )) as unknown as { id: string | null }[];
  return rows[0]?.id ?? undefined;
}
