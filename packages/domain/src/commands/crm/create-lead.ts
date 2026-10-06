import { CreateLeadInput, CreateLeadResultDto, DomainError, newId } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { ActivityRecord } from '../../activities/activity';
import { defineCommand } from '../../command/define-command';
import { findDuplicates, recordDuplicates } from '../../crm/duplicates';
import { toLeadDto } from '../../queries/crm/lead-dto';
import { applyLeadAttribution } from './lead-attribution';
import { firstStage } from './opportunity-shared';
import { attachEnquiry, customerOwner, openEnquiryLead } from '../../crm/repeat-enquiry';

/** What `app.attach_account_entity()` found (migration 0026). */
type AttachStatus = 'attached' | 'already_yours' | 'held_by_other' | 'missing';

/** What `app.lead_phone_status()` found (migration 0055): a status only, never the customer. */
export type PhoneStatus = 'clear' | 'held_by_other';

/**
 * Whether the mobile number of a new customer already belongs to a customer the company deals
 * with through a relationship the caller may not write, so a colleague looks after them there.
 */
export async function phoneStatus(
  tx: RequestTx,
  phone: string,
  entityId: number,
): Promise<PhoneStatus> {
  const rows = (await tx.execute(
    sql`select app.lead_phone_status(${phone}::text, ${entityId}::smallint) as status`,
  )) as unknown as { status: PhoneStatus }[];
  return rows[0]?.status ?? 'clear';
}

/**
 * Holds a new customer's number in its company until the lead form's transaction ends, before
 * the number is looked up (`phoneStatus`), so two people saving one new number at the same moment
 * cannot both find it free: the second waits for the first to commit, then finds the first one's
 * customer. One key, taken once; a wait longer than the connection's `lock_timeout` fails as a
 * conflict. Imports take no number lock (`CommandContext.inImportBatch`), so a form never waits
 * on a batch and batches of different jobs never wait on each other (batches of one job still
 * take turns on the job row); an import committing a brand-new number at the same moment as a
 * form or another import can make a second customer, which the duplicate cards of Phase 1
 * (CRM-03) catch. Two numbers share a lock only when their hashes collide, which costs
 * a wait and nothing else.
 */
export async function lockNewNumber(tx: RequestTx, phone: string, entityId: number): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`lead-phone:${String(entityId)}:${phone}`}, 0))`,
  );
}

/** The refusal of a lead for a customer a colleague looks after in that company (AUDIT M25). */
export function heldByColleague(): DomainError {
  return new DomainError('conflict', 'customer is looked after by a colleague', {
    reason: 'customer_held_by_colleague',
  });
}

/**
 * The timeline row of a new lead. The import batch writes the same row for each lead it makes
 * (`commitLeadBatch`), so a lead from a file reads as one typed in.
 */
export function leadCreatedActivity(
  input: Pick<CreateLeadInput, 'entityId' | 'pipelineKey' | 'sourceCode' | 'existingAccountId'>,
  opportunityId: string,
  accountId: string,
): ActivityRecord {
  return {
    type: 'lead_created',
    opportunityId,
    accountId,
    entityId: input.entityId,
    payload: {
      pipelineKey: input.pipelineKey,
      sourceCode: input.sourceCode ?? null,
      existingAccount: input.existingAccountId !== undefined,
    },
  };
}

/**
 * `crm.lead.create`: an opportunity in the first open stage of the chosen pipeline, owned by the
 * caller, for a new customer (contact with its phone, account, optional site and consent) or for
 * a customer the group already knows (`existingAccountId`, ADR 0008), whose relationship with the
 * caller's entity is added if missing. Walk-in, manual entry and imports come through here
 * (CRM-01). A referral code credits the lead to its partner, or refuses the lead (CRM-09), and
 * the lead is scored with the rules of its company (CRM-06), in the same transaction
 * (`applyLeadAttribution`); the audit row records the partner and the score.
 *
 * Duplicates (CRM-03): a repeat enquiry for the same segment from a customer whose open lead had
 * activity in the last 30 days, or whose lead is in nurture, is added to that lead and answered
 * `attached` (`openEnquiryLead`, `attachEnquiry`); otherwise the new lead's customer is looked around for
 * other customers sharing a number or a name and village, and for another open lead of the
 * segment, and each pair worth a card is recorded (`findDuplicates`, `recordDuplicates`). An
 * import batch does neither, as its set-based path does not: the nightly search
 * (`crm.duplicate.scan`) catches its rows.
 */
export const createLead = defineCommand({
  name: 'crm.lead.create',
  permission: 'crm.lead.write',
  minScope: 'own',
  // A lead creates or attaches a customer, which is a customer write too (ADR 0008, AUDIT L9).
  alsoRequires: [{ permission: 'crm.account.write', minScope: 'own' }],
  input: CreateLeadInput,
  output: CreateLeadResultDto,
  auditFields: ['existingAccount', 'consent', 'score', 'attached'],
  async handler(ctx, input) {
    if (!ctx.entityIds.includes(input.entityId)) {
      throw new DomainError('forbidden', 'entity outside the request scope', {
        entityId: input.entityId,
      });
    }

    const [pipeline] = await ctx.tx
      .select({ id: schema.pipelines.id, segment: schema.pipelines.segment })
      .from(schema.pipelines)
      .where(
        and(
          eq(schema.pipelines.key, input.pipelineKey),
          eq(schema.pipelines.isActive, true),
          or(isNull(schema.pipelines.entityId), eq(schema.pipelines.entityId, input.entityId)),
        ),
      )
      .limit(1);
    // The first open stage, held `for share` until the lead is written, so it is not archived
    // under the new lead (`firstStage`).
    const stage = pipeline ? await firstStage(ctx, pipeline.id, 'open') : undefined;
    if (!pipeline || !stage) {
      throw new DomainError(
        'validation_failed',
        `pipeline ${input.pipelineKey} has no open stage`,
        {
          reason: 'lead_pipeline_missing',
        },
      );
    }

    let sourceId: string | null = null;
    if (input.sourceCode !== undefined) {
      const [source] = await ctx.tx
        .select({ id: schema.leadSources.id })
        .from(schema.leadSources)
        .where(
          and(eq(schema.leadSources.code, input.sourceCode), eq(schema.leadSources.isActive, true)),
        )
        .limit(1);
      if (!source) {
        throw new DomainError('validation_failed', `unknown lead source ${input.sourceCode}`, {
          reason: 'lead_source_unknown',
        });
      }
      sourceId = source.id;
    }

    const actor = ctx.principal.id;
    const teamId = ctx.principal.teamId ?? null;
    const entityId = input.entityId;

    let account: { id: string; type: string; name: string };
    let contact: { id: string; name: string };
    let phone: string;

    if (input.existingAccountId !== undefined) {
      // The caller may not see this customer yet; the helper checks the caller's right to attach
      // their entity and writes the relationship, owned by the caller (docs/05-database.md §4.2).
      const attached = (await ctx.tx.execute(
        sql`select app.attach_account_entity(${input.existingAccountId}::uuid, ${entityId}::smallint) as status`,
      )) as unknown as { status: AttachStatus }[];
      const status = attached[0]?.status ?? 'missing';
      if (status === 'missing') {
        throw new DomainError('not_found', 'account is not available', {
          reason: 'account_missing',
        });
      }
      // A colleague already looks after this customer in this company: the enquiry goes to them
      // or their team lead, rather than a second lead nobody else can see (AUDIT M25).
      if (status === 'held_by_other') throw heldByColleague();
      // A repeat enquiry goes to the customer's lead of the segment, open or in nurture (CRM-03).
      // A relationship made just now has no lead in the company yet.
      if (status === 'already_yours' && ctx.inImportBatch !== true) {
        const open = await openEnquiryLead(ctx, {
          entityId,
          segment: pipeline.segment,
          accountId: input.existingAccountId,
        });
        if (open !== undefined) return attachEnquiry(ctx, input, open, undefined);
      }
      const row = await customerOwner(ctx, input.existingAccountId);
      account = row.account;
      contact = row.contact;
      phone = row.phone;
    } else {
      const contactInput = input.contact;
      const accountInput = input.account;
      if (contactInput === undefined || accountInput === undefined) {
        throw new DomainError('validation_failed', 'contact and account are required');
      }
      // A number that belongs to a customer a colleague looks after in this company is that
      // customer, not a new one: the enquiry goes to the colleague as on the known-customer path,
      // rather than a second customer that splits their consent and DND history. The import
      // commit asks the same question for a whole batch (`commitLeadBatch`). A lead typed in holds
      // the number first, so a second one with it at the same moment waits and then finds this
      // one; an import row does not (`lockNewNumber`).
      if (ctx.inImportBatch !== true) await lockNewNumber(ctx.tx, contactInput.phone, entityId);
      if ((await phoneStatus(ctx.tx, contactInput.phone, entityId)) === 'held_by_other') {
        throw heldByColleague();
      }
      // A repeat enquiry from a customer of the company with this number and name goes to their
      // lead of the segment (CRM-03), rather than a second customer. Another name with the number
      // makes a new customer, put forward as a duplicate below (DECISIONS 06-10-2026).
      if (ctx.inImportBatch !== true) {
        const open = await openEnquiryLead(ctx, {
          entityId,
          segment: pipeline.segment,
          phone: contactInput.phone,
          name: contactInput.name,
        });
        if (open !== undefined) return attachEnquiry(ctx, input, open, contactInput.phone);
      }
      // No `returning` here: the row becomes visible only once its relationship row exists, and
      // Postgres applies the select policy to returned rows.
      account = {
        id: newId(),
        type: accountInput.type,
        name: accountInput.name ?? contactInput.name,
      };
      await ctx.tx.insert(schema.accounts).values({ ...account, createdBy: actor });

      await ctx.tx.insert(schema.accountEntities).values({
        id: newId(),
        accountId: account.id,
        entityId,
        ownerId: actor,
        teamId,
        createdBy: actor,
      });

      contact = { id: newId(), name: contactInput.name };
      await ctx.tx.insert(schema.contacts).values({
        ...contact,
        preferredLanguage: contactInput.preferredLanguage,
        createdBy: actor,
      });

      await ctx.tx.insert(schema.accountContacts).values({
        accountId: account.id,
        contactId: contact.id,
        role: 'owner',
        createdBy: actor,
      });

      await ctx.tx.insert(schema.contactPhones).values({
        id: newId(),
        contactId: contact.id,
        e164: contactInput.phone,
        isPrimary: true,
        isWhatsapp: true,
        createdBy: actor,
      });
      phone = contactInput.phone;
    }

    // A consent given now is evidence whether the customer is new or known (DPDP, DLT 160-series).
    if (input.consent !== undefined) {
      await ctx.tx.insert(schema.consents).values({
        id: newId(),
        contactId: contact.id,
        channel: input.consent.channel,
        purpose: input.consent.purpose,
        source: input.consent.source,
        textVersion: input.consent.textVersion,
        givenAt: ctx.now,
        createdBy: actor,
      });
    }

    let siteId: string | null = null;
    if (input.site !== undefined) {
      siteId = newId();
      await ctx.tx.insert(schema.customerSites).values({
        id: siteId,
        accountId: account.id,
        type: input.site.type,
        village: input.site.village,
        pin: input.site.pin ?? null,
        createdBy: actor,
      });
    }

    const [opportunity] = await ctx.tx
      .insert(schema.opportunities)
      .values({
        id: newId(),
        entityId,
        accountId: account.id,
        siteId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: actor,
        teamId,
        sourceId,
        createdBy: actor,
      })
      .returning();
    if (!opportunity) throw new DomainError('internal', 'opportunity insert returned no row');
    // The partner a referral code names, or the lead refused; then its score and reasons.
    Object.assign(
      opportunity,
      await applyLeadAttribution(ctx, { opportunityId: opportunity.id, entityId, input }),
    );

    await ctx.activity(leadCreatedActivity(input, opportunity.id, account.id));
    if (input.consent !== undefined) {
      await ctx.activity({
        type: 'consent_recorded',
        accountId: account.id,
        entityId,
        payload: {
          channel: input.consent.channel,
          purpose: input.consent.purpose,
          source: input.consent.source,
        },
      });
    }

    ctx.audit({
      aggregateType: 'opportunity',
      aggregateId: opportunity.id,
      entityId,
      after: {
        accountId: account.id,
        contactId: contact.id,
        existingAccount: input.existingAccountId !== undefined,
        siteId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: actor,
        teamId,
        sourceId,
        consent: input.consent ?? null,
        referralPartnerId: opportunity.referralPartnerId,
        score: opportunity.score,
      },
    });

    ctx.emit({
      type: 'crm.lead.created',
      entityId,
      aggregateType: 'opportunity',
      aggregateId: opportunity.id,
      payload: {
        pipelineKey: input.pipelineKey,
        sourceCode: input.sourceCode ?? null,
        existingAccount: input.existingAccountId !== undefined,
      },
    });

    // Other customers that may be this one, and another open lead of the segment (CRM-03).
    if (ctx.inImportBatch !== true) {
      const found = await findDuplicates(ctx, entityId, { accountId: account.id });
      await recordDuplicates(ctx, entityId, found.pairs);
    }

    return { ...toLeadDto(opportunity, account, contact, phone), outcome: 'created' as const };
  },
});
