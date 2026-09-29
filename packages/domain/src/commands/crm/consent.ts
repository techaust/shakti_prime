import {
  ConsentDto,
  DomainError,
  newId,
  RecordConsentInput,
  WithdrawConsentInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from './opportunity-shared';

/** A consent given a minute ahead of the clock still counts as now: clocks drift. */
const GRACE_MS = 60_000;

type ConsentRow = typeof schema.consents.$inferSelect;

function toConsentDto(row: ConsentRow): ConsentDto {
  return ConsentDto.parse({
    id: row.id,
    contactId: row.contactId,
    channel: row.channel,
    purpose: row.purpose,
    source: row.source,
    textVersion: row.textVersion,
    givenAt: row.givenAt.toISOString(),
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    hasEvidence: row.evidenceFileId !== null,
  });
}

/** A contact of the customer, as the caller reads it in the page's company. */
async function contactOfCustomer(
  ctx: CommandContext,
  input: { entityId: number; accountId: string; contactId: string },
): Promise<void> {
  requireEntity(ctx, input.entityId);
  const ac = schema.accountContacts;
  const ae = schema.accountEntities;
  const [found] = await ctx.tx
    .select({ contactId: ac.contactId })
    .from(ac)
    .innerJoin(ae, and(eq(ae.accountId, ac.accountId), eq(ae.entityId, input.entityId)))
    .where(and(eq(ac.accountId, input.accountId), eq(ac.contactId, input.contactId)))
    .limit(1);
  if (!found) {
    throw new DomainError('not_found', `contact ${input.contactId} is not visible`, {
      reason: 'contact_missing',
    });
  }
}

/**
 * `crm.consent.record` (CRM-10, DPDP, DLT 160-series): a consent a contact of the customer gave,
 * per channel and purpose, with its source, the version of the text they agreed to (the wording
 * is the client's) and when, now or earlier. An evidence file, when named, must be one the caller
 * reads; it is fixed with the rest of the evidence once written. The write policy asks the
 * caller's `crm.account.write` scope over the contact (ADR 0008).
 */
export const recordConsent = defineCommand({
  name: 'crm.consent.record',
  permission: 'crm.account.write',
  minScope: 'own',
  input: RecordConsentInput,
  output: ConsentDto,
  auditFields: ['channel', 'purpose', 'source', 'textVersion', 'givenAt', 'evidence'],
  async handler(ctx, input) {
    await contactOfCustomer(ctx, input);
    const givenAt = new Date(input.givenAt);
    if (givenAt.getTime() > ctx.now.getTime() + GRACE_MS) {
      throw new DomainError('validation_failed', 'a consent cannot be given in the future', {
        reason: 'consent_given_in_future',
      });
    }
    if (input.evidenceFileId !== undefined) {
      const [file] = await ctx.tx
        .select({ id: schema.files.id })
        .from(schema.files)
        .where(eq(schema.files.id, input.evidenceFileId))
        .limit(1);
      if (!file) {
        throw new DomainError('not_found', 'the evidence file is not available', {
          reason: 'consent_evidence_missing',
        });
      }
    }
    const [row] = await ctx.tx
      .insert(schema.consents)
      .values({
        id: newId(),
        contactId: input.contactId,
        channel: input.channel,
        purpose: input.purpose,
        source: input.source,
        textVersion: input.textVersion,
        givenAt,
        evidenceFileId: input.evidenceFileId ?? null,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'consent insert returned no row');
    ctx.audit({
      aggregateType: 'consent',
      aggregateId: row.id,
      entityId: input.entityId,
      after: {
        contactId: row.contactId,
        channel: row.channel,
        purpose: row.purpose,
        source: row.source,
        textVersion: row.textVersion,
        givenAt: row.givenAt.toISOString(),
        evidence: row.evidenceFileId !== null,
      },
    });
    await ctx.activity({
      type: 'consent_recorded',
      accountId: input.accountId,
      entityId: input.entityId,
      payload: {
        consentId: row.id,
        channel: row.channel,
        purpose: row.purpose,
        source: row.source,
        textVersion: row.textVersion,
      },
    });
    return toConsentDto(row);
  },
});

/**
 * `crm.consent.withdraw`: the consent ends now. A withdrawal stands (`consents_withdrawal_fixed`);
 * a new consent is recorded as a new row.
 */
export const withdrawConsent = defineCommand({
  name: 'crm.consent.withdraw',
  permission: 'crm.account.write',
  minScope: 'own',
  input: WithdrawConsentInput,
  output: ConsentDto,
  auditFields: ['withdrawnAt'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const c = schema.consents;
    const ac = schema.accountContacts;
    const ae = schema.accountEntities;
    const [consent] = await ctx.tx
      .select({ consent: c })
      .from(c)
      .innerJoin(ac, and(eq(ac.contactId, c.contactId), eq(ac.accountId, input.accountId)))
      .innerJoin(ae, and(eq(ae.accountId, ac.accountId), eq(ae.entityId, input.entityId)))
      .where(eq(c.id, input.consentId))
      .limit(1)
      .for('update', { of: c });
    if (!consent) {
      throw new DomainError('not_found', `consent ${input.consentId} is not visible`, {
        reason: 'consent_missing',
      });
    }
    if (consent.consent.withdrawnAt !== null) {
      throw new DomainError('conflict', 'the consent is already withdrawn', {
        reason: 'consent_already_withdrawn',
      });
    }
    const [row] = await ctx.tx
      .update(c)
      .set({ withdrawnAt: ctx.now, updatedBy: ctx.principal.id })
      .where(and(eq(c.id, input.consentId), isNull(c.withdrawnAt)))
      .returning();
    if (!row) {
      throw new DomainError('forbidden', `consent ${input.consentId} is outside the write scope`);
    }
    ctx.audit({
      aggregateType: 'consent',
      aggregateId: row.id,
      entityId: input.entityId,
      before: { withdrawnAt: null },
      after: { withdrawnAt: ctx.now.toISOString() },
    });
    await ctx.activity({
      type: 'consent_withdrawn',
      accountId: input.accountId,
      entityId: input.entityId,
      payload: { consentId: row.id, channel: row.channel, purpose: row.purpose },
    });
    return toConsentDto(row);
  },
});
