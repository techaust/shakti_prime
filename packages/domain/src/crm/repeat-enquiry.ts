import {
  DomainError,
  newId,
  REPEAT_ENQUIRY_DAYS,
  type CreateLeadInput,
  type CreateLeadResultDto,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, desc, eq, exists, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import { toLeadDto } from '../queries/crm/lead-dto';
import { referralCodeUnknown } from '../commands/crm/lead-attribution';
import { partnerForCode } from '../commands/crm/referrals';
import { reopenOpportunity } from '../commands/crm/reopen-opportunity';
import { holdCustomer } from './hold-customer';

/**
 * Repeat enquiries (PRD CRM-03, docs/design/phase1.md §7.4): an enquiry for the same segment from
 * a customer with an open lead that had activity in the last `REPEAT_ENQUIRY_DAYS` days, or with a
 * lead in nurture the caller may work (the owner's decision of 06-10-2026), is added to that lead,
 * and `crm.lead.create` answers `attached` instead of making a second lead; a lead in nurture is
 * reopened, back in its owner's queue. The customer is the one the form names
 * (`existingAccountId`) or, for a new customer, one of the company's customers with the typed
 * number on a contact and the typed name on that contact or on the customer, compared as the
 * duplicate search compares names (`app.match_text()`). A known number with another name is not
 * taken for the same person (families share numbers): the lead form makes a new customer and a
 * duplicate card for a person to decide (DECISIONS 06-10-2026). Either way the customer is one the
 * caller may change in that company, since a number a colleague's customer holds is refused before
 * this is asked.
 * Everything is read under the caller's own policies. The attribution rule of C3 still applies:
 * a referral code no partner of the company has refuses the enquiry, and a known code credits the
 * open lead when it has no partner yet and the caller may write it. The score is left as it is:
 * no score factor reads an enquiry (CRM-06), and the lead keeps its first source.
 */

type OpportunityRow = typeof schema.opportunities.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The customer's lead of the segment an enquiry joins: the open lead with the latest activity in
 * the window, else the lead in nurture the caller may work that was last active, if any.
 */
export async function openEnquiryLead(
  ctx: CommandContext,
  args: { entityId: number; segment: string } & (
    { accountId: string } | { phone: string; name: string }
  ),
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
            .innerJoin(schema.accounts, eq(schema.accounts.id, ac.accountId))
            .where(
              and(
                eq(ph.e164, args.phone),
                or(
                  sql`app.match_text(${c.name}) = app.match_text(${args.name})`,
                  sql`app.match_text(${schema.accounts.name}) = app.match_text(${args.name})`,
                ),
              ),
            ),
        );
  const latest = sql<Date>`(select max(${a.createdAt}) from ${a} where ${a.opportunityId} = ${o.id})`;
  const [row] = await ctx.tx
    .select({ lead: o })
    .from(o)
    .innerJoin(p, and(eq(p.id, o.pipelineId), eq(p.segment, args.segment)))
    .innerJoin(
      schema.accounts,
      and(eq(schema.accounts.id, o.accountId), isNull(schema.accounts.archivedAt)),
    )
    .where(
      and(
        eq(o.entityId, args.entityId),
        isNull(o.archivedAt),
        customer,
        or(
          and(
            eq(o.state, 'open'),
            exists(
              ctx.tx
                .select({ one: sql`1` })
                .from(a)
                .where(and(eq(a.opportunityId, o.id), gte(a.createdAt, since))),
            ),
          ),
          and(
            eq(o.state, 'nurture'),
            sql`app.scope_ok('crm.lead.write', ${o.ownerId}, ${o.teamId})`,
          ),
        ),
      ),
    )
    .orderBy(desc(sql`${o.state} = 'open'`), sql`${latest} desc nulls last`, desc(o.id))
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
 * The lead as it stands once its customer is held (`holdCustomer`): a merge that committed while
 * the enquiry was looked up has moved it to the kept customer, which is then held in turn.
 */
async function heldLead(ctx: CommandContext, found: OpportunityRow): Promise<OpportunityRow> {
  const o = schema.opportunities;
  let lead = found;
  for (let tries = 0; tries < 3; tries += 1) {
    await holdCustomer(ctx, lead.accountId);
    const [current] = await ctx.tx
      .select()
      .from(o)
      .where(and(eq(o.id, lead.id), isNull(o.archivedAt), inArray(o.state, ['open', 'nurture'])))
      .limit(1);
    if (!current) break;
    if (current.accountId === lead.accountId) return current;
    lead = current;
  }
  throw new DomainError('not_found', `opportunity ${found.id} changed meanwhile`, {
    reason: 'lead_missing',
  });
}

/**
 * Adds the enquiry to the lead: a lead in nurture is reopened first (`crm.opportunity.reopen`, in
 * this transaction), then a timeline row on the lead, the consent given now (on the contact with
 * the typed number, else the customer's owner), the referral code's partner when the lead has
 * none, an audit row and `crm.lead.attached`. Answers the lead as `attached`.
 */
export async function attachEnquiry(
  ctx: CommandContext,
  input: CreateLeadInput,
  found: OpportunityRow,
  typedPhone: string | undefined,
): Promise<CreateLeadResultDto> {
  const o = schema.opportunities;
  const lead = await heldLead(ctx, found);
  if (lead.state === 'nurture') {
    await ctx.run(reopenOpportunity, { entityId: lead.entityId, opportunityId: lead.id });
  }
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
