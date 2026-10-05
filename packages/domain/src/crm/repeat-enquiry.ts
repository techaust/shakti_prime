import {
  DomainError,
  newId,
  REPEAT_ENQUIRY_DAYS,
  type CreateLeadInput,
  type CreateLeadResultDto,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, desc, eq, exists, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import { toLeadDto } from '../queries/crm/lead-dto';
import { referralCodeUnknown } from '../commands/crm/lead-attribution';
import { partnerForCode } from '../commands/crm/referrals';

/**
 * Repeat enquiries (PRD CRM-03, docs/design/phase1.md §7.4): an enquiry for the same segment from
 * a customer with an open lead that had activity in the last `REPEAT_ENQUIRY_DAYS` days is added
 * to that lead, and `crm.lead.create` answers `attached` instead of making a second lead. The
 * customer is the one the form names (`existingAccountId`) or, for a new customer, one of the
 * company's customers with the typed number on a contact; either way one the caller may change in
 * that company, since a number a colleague's customer holds is refused before this is asked.
 * Everything is read under the caller's own policies. The attribution rule of C3 still applies:
 * a referral code no partner of the company has refuses the enquiry, and a known code credits the
 * open lead when it has no partner yet and the caller may write it. The score is left as it is:
 * no score factor reads an enquiry (CRM-06), and the lead keeps its first source.
 */

type OpportunityRow = typeof schema.opportunities.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The customer's open lead of the segment with the latest activity in the window, if any. */
export async function openEnquiryLead(
  ctx: CommandContext,
  args: { entityId: number; segment: string } & ({ accountId: string } | { phone: string }),
): Promise<OpportunityRow | undefined> {
  const o = schema.opportunities;
  const p = schema.pipelines;
  const a = schema.activities;
  const since = new Date(ctx.now.getTime() - REPEAT_ENQUIRY_DAYS * DAY_MS);
  const ac = schema.accountContacts;
  const ph = schema.contactPhones;
  const c = schema.contacts;
  const customer =
    'accountId' in args
      ? eq(o.accountId, args.accountId)
      : inArray(
          o.accountId,
          ctx.tx
            .select({ id: ac.accountId })
            .from(ac)
            .innerJoin(ph, eq(ph.contactId, ac.contactId))
            .innerJoin(c, and(eq(c.id, ac.contactId), isNull(c.archivedAt)))
            .where(eq(ph.e164, args.phone)),
        );
  const latest = sql<Date>`(select max(${a.createdAt}) from ${a}
    where ${a.opportunityId} = ${o.id} and ${a.createdAt} >= ${since.toISOString()}::timestamptz)`;
  const [row] = await ctx.tx
    .select({ lead: o })
    .from(o)
    .innerJoin(p, and(eq(p.id, o.pipelineId), eq(p.segment, args.segment)))
    .innerJoin(schema.accounts, and(eq(schema.accounts.id, o.accountId), isNull(schema.accounts.archivedAt)))
    .where(
      and(
        eq(o.entityId, args.entityId),
        eq(o.state, 'open'),
        isNull(o.archivedAt),
        customer,
        exists(
          ctx.tx
            .select({ one: sql`1` })
            .from(a)
            .where(and(eq(a.opportunityId, o.id), gte(a.createdAt, since))),
        ),
      ),
    )
    .orderBy(desc(latest), desc(o.id))
    .limit(1);
  return row?.lead;
}

/** A customer's owner contact and its main number, as the lead form's answer shows them. */
export async function customerOwner(
  ctx: CommandContext,
  accountId: string,
): Promise<{
  account: { id: string; type: string; name: string };
  contact: { id: string; name: string };
  phone: string;
}> {
  const [row] = await ctx.tx
    .select({
      account: { id: schema.accounts.id, type: schema.accounts.type, name: schema.accounts.name },
      contact: { id: schema.contacts.id, name: schema.contacts.name },
      phone: schema.contactPhones.e164,
    })
    .from(schema.accounts)
    .innerJoin(
      schema.accountContacts,
      and(
        eq(schema.accountContacts.accountId, schema.accounts.id),
        eq(schema.accountContacts.role, 'owner'),
      ),
    )
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.accountContacts.contactId))
    .innerJoin(
      schema.contactPhones,
      and(
        eq(schema.contactPhones.contactId, schema.contacts.id),
        eq(schema.contactPhones.isPrimary, true),
      ),
    )
    .where(eq(schema.accounts.id, accountId))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', 'account has no owner contact', {
      reason: 'account_missing',
    });
  }
  return row;
}

/**
 * Adds the enquiry to the open lead: a timeline row on the lead, the consent given now (on the
 * contact with the typed number, else the customer's owner), the referral code's partner when the
 * lead has none, an audit row and `crm.lead.attached`. Answers the lead as `attached`.
 */
export async function attachEnquiry(
  ctx: CommandContext,
  input: CreateLeadInput,
  lead: OpportunityRow,
  typedPhone: string | undefined,
): Promise<CreateLeadResultDto> {
  const o = schema.opportunities;
  let partnerId: string | null = null;
  if (input.referralCode !== undefined) {
    const partner = await partnerForCode(ctx.tx, input.referralCode, lead.entityId);
    if (partner === undefined) throw referralCodeUnknown();
    if (lead.referralPartnerId === null) {
      // Under the update policy: a lead the caller may only read keeps no partner.
      const [credited] = await ctx.tx
        .update(o)
        .set({ referralPartnerId: partner })
        .where(and(eq(o.id, lead.id), isNull(o.referralPartnerId)))
        .returning({ id: o.id });
      if (credited) partnerId = partner;
    }
  }

  const owner = await customerOwner(ctx, lead.accountId);
  if (input.consent !== undefined) {
    let contactId = owner.contact.id;
    if (typedPhone !== undefined) {
      const [match] = await ctx.tx
        .select({ id: schema.accountContacts.contactId })
        .from(schema.accountContacts)
        .innerJoin(
          schema.contactPhones,
          eq(schema.contactPhones.contactId, schema.accountContacts.contactId),
        )
        .where(
          and(
            eq(schema.accountContacts.accountId, lead.accountId),
            eq(schema.contactPhones.e164, typedPhone),
          ),
        )
        .limit(1);
      if (match) contactId = match.id;
    }
    await ctx.tx.insert(schema.consents).values({
      id: newId(),
      contactId,
      channel: input.consent.channel,
      purpose: input.consent.purpose,
      source: input.consent.source,
      textVersion: input.consent.textVersion,
      givenAt: ctx.now,
      createdBy: ctx.principal.id,
    });
  }

  await ctx.activity({
    type: 'enquiry_repeated',
    opportunityId: lead.id,
    accountId: lead.accountId,
    entityId: lead.entityId,
    payload: {
      pipelineKey: input.pipelineKey,
      sourceCode: input.sourceCode ?? null,
      consent: input.consent !== undefined,
    },
  });
  if (input.consent !== undefined) {
    await ctx.activity({
      type: 'consent_recorded',
      accountId: lead.accountId,
      entityId: lead.entityId,
      payload: {
        channel: input.consent.channel,
        purpose: input.consent.purpose,
        source: input.consent.source,
      },
    });
  }
  ctx.audit({
    aggregateType: 'opportunity',
    aggregateId: lead.id,
    entityId: lead.entityId,
    before: null,
    after: {
      attached: true,
      consent: input.consent ?? null,
      ...(partnerId === null ? {} : { referralPartnerId: partnerId }),
    },
  });
  ctx.emit({
    type: 'crm.lead.attached',
    entityId: lead.entityId,
    aggregateType: 'opportunity',
    aggregateId: lead.id,
    payload: { pipelineKey: input.pipelineKey, sourceCode: input.sourceCode ?? null },
  });
  const [current] = await ctx.tx.select().from(o).where(eq(o.id, lead.id)).limit(1);
  return {
    ...toLeadDto(current ?? lead, owner.account, owner.contact, owner.phone),
    outcome: 'attached',
  };
}
