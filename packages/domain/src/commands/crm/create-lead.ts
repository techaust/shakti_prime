import { CreateLeadInput, DomainError, LeadDto, newId } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { toLeadDto } from '../../queries/crm/lead-dto';

/**
 * `crm.lead.create`: a contact with its phone, an account, an optional site and consent, and an
 * opportunity in the first open stage of the chosen pipeline, all owned by the caller. Walk-in,
 * manual entry and imports come through here (CRM-01). Dedupe suggestions are Phase 1.
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

    const [contact] = await ctx.tx
      .insert(schema.contacts)
      .values({
        id: newId(),
        entityId,
        name: input.contact.name,
        nameHi: input.contact.nameHi ?? null,
        preferredLanguage: input.contact.preferredLanguage,
        ownerId: actor,
        teamId,
        createdBy: actor,
      })
      .returning({ id: schema.contacts.id, name: schema.contacts.name });
    if (!contact) throw new DomainError('internal', 'contact insert returned no row');

    await ctx.tx.insert(schema.contactPhones).values({
      id: newId(),
      entityId,
      contactId: contact.id,
      e164: input.contact.phone,
      isPrimary: true,
      isWhatsapp: true,
      createdBy: actor,
    });

    const [account] = await ctx.tx
      .insert(schema.accounts)
      .values({
        id: newId(),
        entityId,
        type: input.account.type,
        name: input.account.name ?? input.contact.name,
        ownerId: actor,
        teamId,
        createdBy: actor,
      })
      .returning({
        id: schema.accounts.id,
        type: schema.accounts.type,
        name: schema.accounts.name,
      });
    if (!account) throw new DomainError('internal', 'account insert returned no row');

    await ctx.tx.insert(schema.accountContacts).values({
      entityId,
      accountId: account.id,
      contactId: contact.id,
      role: 'owner',
      createdBy: actor,
    });

    let siteId: string | null = null;
    if (input.site !== undefined) {
      siteId = newId();
      await ctx.tx.insert(schema.customerSites).values({
        id: siteId,
        entityId,
        accountId: account.id,
        type: input.site.type,
        village: input.site.village,
        pin: input.site.pin ?? null,
        createdBy: actor,
      });
    }

    if (input.consent !== undefined) {
      await ctx.tx.insert(schema.consents).values({
        id: newId(),
        entityId,
        contactId: contact.id,
        channel: input.consent.channel,
        purpose: input.consent.purpose,
        source: input.consent.source,
        textVersion: input.consent.textVersion,
        givenAt: ctx.now,
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
      payload: { pipelineKey: input.pipelineKey, sourceCode: input.sourceCode ?? null },
    });

    return toLeadDto(opportunity, account, contact, input.contact.phone);
  },
});
