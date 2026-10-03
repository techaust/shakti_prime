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

/** The consent as Account 360 shows it; `readableEvidence` is the proof when the caller may open it. */
function toConsentDto(row: ConsentRow, readableEvidence: string | null): ConsentDto {
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
    evidenceFileId: readableEvidence,
  });
}

/**
 * The proof a consent rests on: a file of the `consent_evidence` purpose, of the page's company,
 * that the caller may read (the `files` policies) and that has passed its checks. A file another
 * company holds, of another purpose or out of the caller's sight is not found; one still being
 * checked waits for its checks; one the checks refused is refused.
 */
async function requireEvidence(
  ctx: CommandContext,
  input: { entityId: number; evidenceFileId: string },
): Promise<string> {
  const f = schema.files;
  const [file] = await ctx.tx
    .select({ id: f.id, status: f.status })
    .from(f)
    .where(
      and(
        eq(f.id, input.evidenceFileId),
        eq(f.entityId, input.entityId),
        eq(f.purpose, 'consent_evidence'),
      ),
    )
    .limit(1);
  if (!file) {
    throw new DomainError('not_found', `evidence file ${input.evidenceFileId} is not visible`, {
      reason: 'consent_evidence_missing',
    });
  }
  if (file.status === 'rejected') {
    throw new DomainError('validation_failed', 'the evidence file was refused by its checks', {
      reason: 'consent_evidence_refused',
    });
  }
  if (file.status !== 'ready') {
    throw new DomainError('conflict', 'the evidence file is still being checked', {
      reason: 'consent_evidence_checking',
    });
  }
  return file.id;
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
 * is the client's) and when, now or earlier, with an optional proof file uploaded for it (a signed
 * form, a photo of it) that has passed its checks; the file is fixed with the rest of the evidence
 * once written. The write policy asks the caller's `crm.account.write` scope over the contact
 * (ADR 0008).
 */
export const recordConsent = defineCommand({
  name: 'crm.consent.record',
  permission: 'crm.account.write',
  minScope: 'own',
  input: RecordConsentInput,
  output: ConsentDto,
  auditFields: ['channel', 'consentPurpose', 'source', 'textVersion', 'givenAt', 'evidence'],
  async handler(ctx, input) {
    await contactOfCustomer(ctx, input);
    const givenAt = new Date(input.givenAt);
    if (givenAt.getTime() > ctx.now.getTime() + GRACE_MS) {
      throw new DomainError('validation_failed', 'a consent cannot be given in the future', {
        reason: 'consent_given_in_future',
      });
    }
    const evidenceFileId =
      input.evidenceFileId === undefined
        ? null
        : await requireEvidence(ctx, {
            entityId: input.entityId,
            evidenceFileId: input.evidenceFileId,
          });
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
        evidenceFileId,
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
        consentPurpose: row.purpose,
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
      },
    });
    return toConsentDto(row, evidenceFileId);
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
      .select({ consent: c, readableEvidence: schema.files.id })
      .from(c)
      .innerJoin(ac, and(eq(ac.contactId, c.contactId), eq(ac.accountId, input.accountId)))
      .innerJoin(ae, and(eq(ae.accountId, ac.accountId), eq(ae.entityId, input.entityId)))
      .leftJoin(schema.files, eq(schema.files.id, c.evidenceFileId))
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
    return toConsentDto(row, consent.readableEvidence);
  },
});
