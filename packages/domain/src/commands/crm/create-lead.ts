import { CreateLeadInput, DomainError, LeadDto, newId } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { toLeadDto } from '../../queries/crm/lead-dto';

/**
 * `crm.lead.create`: an opportunity in the first open stage of the chosen pipeline, owned by the
 * caller, for a new customer (contact with its phone, account, optional site and consent) or for
 * a customer the group already knows (`existingAccountId`, ADR 0008), whose relationship with the
 * caller's entity is added if missing. Walk-in, manual entry and imports come through here
 * (CRM-01). Dedupe suggestions are Phase 1.
 */
export const createLead = defineCommand({
  name: 'crm.lead.create',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: CreateLeadInput,
  output: LeadDto,
  async handler(ctx, input) {
    if (!ctx.entityIds.includes(input.entityId)) {
      throw new DomainError('forbidden', 'entity outside the request scope', {
        entityId: input.entityId,
      });
    }

    const [pipeline] = await ctx.tx
      .select({ id: schema.pipelines.id })
      .from(schema.pipelines)
      .where(
        and(
          eq(schema.pipelines.key, input.pipelineKey),
          eq(schema.pipelines.isActive, true),
          or(isNull(schema.pipelines.entityId), eq(schema.pipelines.entityId, input.entityId)),
        ),
      )
      .limit(1);
    const [stage] = pipeline
      ? await ctx.tx
          .select({ id: schema.pipelineStages.id })
          .from(schema.pipelineStages)
          .where(
            and(
              eq(schema.pipelineStages.pipelineId, pipeline.id),
              eq(schema.pipelineStages.kind, 'open'),
            ),
          )
          .orderBy(asc(schema.pipelineStages.position))
          .limit(1)
      : [];
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
      // their entity and writes the relationship, owned by the caller (docs/DATABASE.md §4.2).
      const attached = (await ctx.tx.execute(
        sql`select app.attach_account_entity(${input.existingAccountId}::uuid, ${entityId}::smallint) as ok`,
      )) as unknown as { ok: boolean }[];
      if (attached[0]?.ok !== true) {
        throw new DomainError('not_found', 'account is not available', {
          reason: 'account_missing',
        });
      }
      const [row] = await ctx.tx
        .select({
          account: {
            id: schema.accounts.id,
            type: schema.accounts.type,
            name: schema.accounts.name,
          },
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
        .where(eq(schema.accounts.id, input.existingAccountId))
        .limit(1);
      if (!row) {
        throw new DomainError('not_found', 'account has no owner contact', {
          reason: 'account_missing',
        });
      }
      account = row.account;
      contact = row.contact;
      phone = row.phone;
    } else {
      const contactInput = input.contact;
      const accountInput = input.account;
      if (contactInput === undefined || accountInput === undefined) {
        throw new DomainError('validation_failed', 'contact and account are required');
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
        nameHi: contactInput.nameHi ?? null,
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

    return toLeadDto(opportunity, account, contact, phone);
  },
});
