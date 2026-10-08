import {
  AddNoteInput,
  CustomerChangeDto,
  DomainError,
  newId,
  NoteDto,
  UpdateAccountInput,
  UpdateContactInput,
  UpsertSiteInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { holdCustomer } from '../../crm/hold-customer';
import { heldByColleague, lockNewNumber } from './create-lead';
import { requireEntity } from './opportunity-shared';

/**
 * The customer edits of Account 360 (docs/03-roadmap-appendix/phase1.md §6.5). The customer is one record for
 * the group (ADR 0008): the caller must read it in the page's company, and the write policies
 * (`app.account_in_scope()`, `app.contact_in_scope()`) ask the caller's `crm.account.write` scope
 * over a relationship of the customer in a company of the request. Reading a customer through a
 * lead (0057) gives no right to change it. Each edit writes one audit row for what it changed and
 * one timeline row in the page's company.
 */

/** The customer, as the caller reads it in the page's company; a customer they cannot is missing. */
async function readableAccount(ctx: CommandContext, accountId: string, entityId: number) {
  requireEntity(ctx, entityId);
  // Before the read: a merge of the customer that commits first leaves it archived (CRM-03).
  await holdCustomer(ctx, accountId);
  const a = schema.accounts;
  const ae = schema.accountEntities;
  const [row] = await ctx.tx
    .select({
      id: a.id,
      name: a.name,
      type: a.type,
      gstin: a.gstin,
      billingStateCode: a.billingStateCode,
    })
    .from(a)
    .innerJoin(ae, and(eq(ae.accountId, a.id), eq(ae.entityId, entityId)))
    .where(and(eq(a.id, accountId), isNull(a.archivedAt)))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `account ${accountId} is not visible`, {
      reason: 'account_missing',
    });
  }
  return row;
}

/** Fields a caller may leave out: undefined leaves a field as it is. */
type Wanted<T> = { [K in keyof T]?: T[K] | undefined };

/** The names of the fields whose value changes, in the order given. */
function changedFields<T extends object>(before: T, after: Wanted<T>): (keyof T & string)[] {
  return (Object.keys(after) as (keyof T & string)[]).filter(
    (k) => after[k] !== undefined && after[k] !== before[k],
  );
}

/** Keeps the listed fields of `row`. */
function pick<T extends object>(row: T, keys: readonly (keyof T)[]): Partial<T> {
  return Object.fromEntries(keys.map((k) => [k, row[k]])) as Partial<T>;
}

/** The customer's timeline row for an edit, in the page's company. */
function recordEdit(
  ctx: CommandContext,
  input: { accountId: string; entityId: number },
  type: 'customer_updated' | 'site_updated',
  payload: Record<string, string | boolean | null>,
): Promise<void> {
  return ctx.activity({ type, accountId: input.accountId, entityId: input.entityId, payload });
}

function denied(what: string): DomainError {
  return new DomainError('forbidden', `${what} is outside the caller's customer write scope`);
}

/** `crm.account.update`: the customer's name, type, GSTIN and billing state code. */
export const updateAccount = defineCommand({
  name: 'crm.account.update',
  permission: 'crm.account.write',
  minScope: 'own',
  input: UpdateAccountInput,
  output: CustomerChangeDto,
  auditFields: ['name', 'accountType', 'gstin', 'billingStateCode'],
  async handler(ctx, input) {
    const account = await readableAccount(ctx, input.accountId, input.entityId);
    const current = {
      name: account.name,
      accountType: account.type,
      gstin: account.gstin,
      billingStateCode: account.billingStateCode,
    };
    const wanted = {
      name: input.name,
      accountType: input.type,
      gstin: input.gstin,
      billingStateCode: input.billingStateCode,
    };
    const changed = changedFields(current, wanted);
    const a = schema.accounts;
    const [row] = await ctx.tx
      .update(a)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.type === undefined ? {} : { type: input.type }),
        ...(input.gstin === undefined ? {} : { gstin: input.gstin }),
        ...(input.billingStateCode === undefined
          ? {}
          : { billingStateCode: input.billingStateCode }),
        updatedBy: ctx.principal.id,
      })
      .where(eq(a.id, account.id))
      .returning({ id: a.id, updatedAt: a.updatedAt });
    if (!row) throw denied(`account ${account.id}`);
    if (changed.length > 0) {
      ctx.audit({
        aggregateType: 'account',
        aggregateId: account.id,
        entityId: input.entityId,
        before: pick(current, changed),
        after: pick(wanted, changed),
      });
      await recordEdit(ctx, input, 'customer_updated', { changed: changed.join(',') });
    }
    return {
      accountId: account.id,
      contactId: null,
      siteId: null,
      updatedAt: row.updatedAt.toISOString(),
    };
  },
});

/**
 * `crm.contact.update`: a contact of the customer, with its numbers. Numbers are added (E.164
 * through the phone normaliser of the input), one becomes the main number, and numbers are taken
 * off while at least one stays; when the main number is taken off and no other is named, the
 * oldest number left becomes the main one.
 */
export const updateContact = defineCommand({
  name: 'crm.contact.update',
  permission: 'crm.account.write',
  minScope: 'own',
  input: UpdateContactInput,
  output: CustomerChangeDto,
  auditFields: ['name', 'email', 'preferredLanguage', 'phones', 'primaryPhone'],
  constraintReasons: { contact_phones_contact_e164_unique: 'phone_already_on_contact' },
  async handler(ctx, input) {
    await readableAccount(ctx, input.accountId, input.entityId);
    const c = schema.contacts;
    const ac = schema.accountContacts;
    const [contact] = await ctx.tx
      .select({
        id: c.id,
        name: c.name,
        email: c.email,
        preferredLanguage: c.preferredLanguage,
        updatedAt: c.updatedAt,
      })
      .from(c)
      .innerJoin(ac, and(eq(ac.contactId, c.id), eq(ac.accountId, input.accountId)))
      .where(and(eq(c.id, input.contactId), isNull(c.archivedAt)))
      .limit(1)
      .for('update', { of: c });
    if (!contact) {
      throw new DomainError('not_found', `contact ${input.contactId} is not visible`, {
        reason: 'contact_missing',
      });
    }

    const cp = schema.contactPhones;
    const phones = await ctx.tx
      .select({ id: cp.id, e164: cp.e164, isPrimary: cp.isPrimary, createdAt: cp.createdAt })
      .from(cp)
      .where(eq(cp.contactId, contact.id))
      .orderBy(cp.createdAt, cp.id);
    const removeIds = [...new Set(input.removePhoneIds ?? [])];
    const known = new Set(phones.map((p) => p.id));
    if (removeIds.some((id) => !known.has(id))) {
      throw new DomainError('not_found', 'a number to take off is not on this contact', {
        reason: 'phone_missing',
      });
    }
    const kept = phones.filter((p) => !removeIds.includes(p.id));
    const added = (input.addPhones ?? []).filter(
      (p, i, all) => all.findIndex((q) => q.phone === p.phone) === i,
    );
    if (kept.length + added.length === 0) {
      throw new DomainError('validation_failed', 'a contact keeps at least one number', {
        reason: 'phone_last_one',
      });
    }
    if (input.primaryPhoneId !== undefined && !kept.some((p) => p.id === input.primaryPhoneId)) {
      throw new DomainError('not_found', 'the main number must be one the contact keeps', {
        reason: 'phone_missing',
      });
    }

    // A number that belongs to a colleague's customer is that customer, not a second number of
    // this one: refused and routed as the lead form refuses it (AUDIT M25). The lead form's number
    // lock is held in each company of the request first, so a lead typed at the same moment with
    // the number waits for this change, or this change for it.
    for (const p of added) {
      if (phones.some((q) => q.e164 === p.phone)) continue;
      for (const entityId of [...ctx.entityIds].sort((a, b) => a - b)) {
        await lockNewNumber(ctx.tx, p.phone, entityId);
      }
      const rows = (await ctx.tx.execute(
        sql`select app.contact_phone_status(${p.phone}::text, ${input.accountId}::uuid) as status`,
      )) as unknown as { status: 'clear' | 'held_by_other' }[];
      if (rows[0]?.status === 'held_by_other') throw heldByColleague();
    }

    const currentFields = {
      name: contact.name,
      email: contact.email,
      preferredLanguage: contact.preferredLanguage,
    };
    const wantedFields = {
      name: input.name,
      email: input.email,
      preferredLanguage: input.preferredLanguage,
    };
    const fieldsChanged = changedFields(currentFields, wantedFields);
    const changed: string[] = [...fieldsChanged];
    const [updatedContact] = await ctx.tx
      .update(c)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.preferredLanguage === undefined
          ? {}
          : { preferredLanguage: input.preferredLanguage }),
        updatedBy: ctx.principal.id,
      })
      .where(eq(c.id, contact.id))
      .returning({ updatedAt: c.updatedAt });
    if (!updatedContact) throw denied(`contact ${contact.id}`);

    if (removeIds.length > 0) {
      const gone = await ctx.tx
        .delete(cp)
        .where(and(eq(cp.contactId, contact.id), inArray(cp.id, removeIds)))
        .returning({ id: cp.id });
      if (gone.length !== removeIds.length) throw denied(`numbers of contact ${contact.id}`);
    }
    const newRows = added.map((p) => ({
      id: newId(),
      contactId: contact.id,
      e164: p.phone,
      isPrimary: false,
      isWhatsapp: p.isWhatsapp,
      createdBy: ctx.principal.id,
    }));
    if (newRows.length > 0) await ctx.tx.insert(cp).values(newRows);

    const before = phones.find((p) => p.isPrimary);
    const primary =
      input.primaryPhoneId ??
      (before !== undefined && !removeIds.includes(before.id) ? before.id : undefined) ??
      kept[0]?.id ??
      newRows[0]?.id;
    if (primary !== undefined && primary !== before?.id) {
      // One main number a contact: the old one steps down first (`contact_phones_primary_unique`).
      await ctx.tx
        .update(cp)
        .set({ isPrimary: false, updatedBy: ctx.principal.id })
        .where(and(eq(cp.contactId, contact.id), eq(cp.isPrimary, true), ne(cp.id, primary)));
      const made = await ctx.tx
        .update(cp)
        .set({ isPrimary: true, updatedBy: ctx.principal.id })
        .where(and(eq(cp.contactId, contact.id), eq(cp.id, primary)))
        .returning({ id: cp.id });
      if (made.length !== 1) throw denied(`numbers of contact ${contact.id}`);
    }

    const beforePhones = phones.map((p) => p.e164);
    const afterPhones = [...kept.map((p) => p.e164), ...newRows.map((p) => p.e164)];
    const phonesChanged = removeIds.length > 0 || newRows.length > 0;
    const primaryE164 = (id: string | undefined) =>
      [...phones, ...newRows].find((p) => p.id === id)?.e164 ?? null;
    const primaryChanged = primary !== before?.id;
    const beforeAudit: Record<string, unknown> = pick(currentFields, fieldsChanged);
    const afterAudit: Record<string, unknown> = pick(wantedFields, fieldsChanged);
    if (phonesChanged) {
      beforeAudit.phones = beforePhones;
      afterAudit.phones = afterPhones;
      changed.push('phones');
    }
    if (primaryChanged) {
      beforeAudit.primaryPhone = primaryE164(before?.id);
      afterAudit.primaryPhone = primaryE164(primary);
      changed.push('primaryPhone');
    }
    if (changed.length > 0) {
      ctx.audit({
        aggregateType: 'contact',
        aggregateId: contact.id,
        entityId: input.entityId,
        before: beforeAudit,
        after: afterAudit,
      });
      await recordEdit(ctx, input, 'customer_updated', {
        contactId: contact.id,
        changed: changed.join(','),
      });
    }
    return {
      accountId: input.accountId,
      contactId: contact.id,
      siteId: null,
      updatedAt: updatedContact.updatedAt.toISOString(),
    };
  },
});

interface SiteFields {
  siteType: string;
  address: string | null;
  village: string | null;
  tehsil: string | null;
  district: string | null;
  pin: string | null;
  stateCode: string | null;
  lat: string | null;
  lng: string | null;
}

/** A coordinate as the `numeric(9,6)` column keeps it. */
const coordinate = (value: number): string => value.toFixed(6);

/**
 * `crm.site.upsert`: a borewell, rooftop or factory of the customer, new or changed: its type,
 * address, village, tehsil, district, PIN, GST state code and map point.
 */
export const upsertSite = defineCommand({
  name: 'crm.site.upsert',
  permission: 'crm.account.write',
  minScope: 'own',
  input: UpsertSiteInput,
  output: CustomerChangeDto,
  auditFields: [
    'siteType',
    'address',
    'village',
    'tehsil',
    'district',
    'pin',
    'stateCode',
    'lat',
    'lng',
  ],
  async handler(ctx, input) {
    await readableAccount(ctx, input.accountId, input.entityId);
    const cs = schema.customerSites;
    const wanted: Wanted<SiteFields> = {
      siteType: input.type,
      address: input.address,
      village: input.village,
      tehsil: input.tehsil,
      district: input.district,
      pin: input.pin,
      stateCode: input.stateCode,
      ...(input.location === undefined
        ? {}
        : {
            lat: input.location === null ? null : coordinate(input.location.lat),
            lng: input.location === null ? null : coordinate(input.location.lng),
          }),
    };
    const columns = (fields: Wanted<SiteFields>) => ({
      ...(fields.siteType === undefined ? {} : { type: fields.siteType }),
      ...(fields.address === undefined ? {} : { address: fields.address }),
      ...(fields.village === undefined ? {} : { village: fields.village }),
      ...(fields.tehsil === undefined ? {} : { tehsil: fields.tehsil }),
      ...(fields.district === undefined ? {} : { district: fields.district }),
      ...(fields.pin === undefined ? {} : { pin: fields.pin }),
      ...(fields.stateCode === undefined ? {} : { stateCode: fields.stateCode }),
      ...(fields.lat === undefined ? {} : { lat: fields.lat }),
      ...(fields.lng === undefined ? {} : { lng: fields.lng }),
    });

    if (input.siteId === undefined) {
      const siteId = newId();
      // No `returning`: a new site is read back through its customer, as the lead command does.
      await ctx.tx.insert(cs).values({
        id: siteId,
        accountId: input.accountId,
        type: input.type,
        ...columns(wanted),
        createdBy: ctx.principal.id,
      });
      const after = Object.fromEntries(
        Object.entries(wanted).filter(([, v]) => typeof v === 'string'),
      );
      ctx.audit({ aggregateType: 'site', aggregateId: siteId, entityId: input.entityId, after });
      await recordEdit(ctx, input, 'site_updated', { siteId, created: true });
      return {
        accountId: input.accountId,
        contactId: null,
        siteId,
        updatedAt: ctx.now.toISOString(),
      };
    }

    const [site] = await ctx.tx
      .select({
        id: cs.id,
        siteType: cs.type,
        address: cs.address,
        village: cs.village,
        tehsil: cs.tehsil,
        district: cs.district,
        pin: cs.pin,
        stateCode: cs.stateCode,
        lat: cs.lat,
        lng: cs.lng,
      })
      .from(cs)
      .where(and(eq(cs.id, input.siteId), eq(cs.accountId, input.accountId), isNull(cs.archivedAt)))
      .limit(1)
      .for('update');
    if (!site) {
      throw new DomainError('not_found', `site ${input.siteId} is not visible`, {
        reason: 'site_missing',
      });
    }
    const { id: siteId, ...rest } = site;
    const current: SiteFields = rest;
    const changed = changedFields(current, wanted);
    const [row] = await ctx.tx
      .update(cs)
      .set({ ...columns(wanted), updatedBy: ctx.principal.id })
      .where(eq(cs.id, siteId))
      .returning({ updatedAt: cs.updatedAt });
    if (!row) throw denied(`site ${siteId}`);
    if (changed.length > 0) {
      ctx.audit({
        aggregateType: 'site',
        aggregateId: siteId,
        entityId: input.entityId,
        before: pick(current, changed),
        after: pick(wanted, changed),
      });
      await recordEdit(ctx, input, 'site_updated', { siteId, created: false });
    }
    return {
      accountId: input.accountId,
      contactId: null,
      siteId,
      updatedAt: row.updatedAt.toISOString(),
    };
  },
});

/**
 * `crm.note.add`: a note on the customer's timeline in the page's company, by someone who may
 * change the customer, or on one of their leads that is not archived, by someone who may work it;
 * the timeline's insert policy asks the same. People only: agents work without notes.
 */
export const addNote = defineCommand({
  name: 'crm.note.add',
  permission: 'crm.lead.write',
  minScope: 'own',
  // Agents work without customers' notes (docs/07-security.md §3.3).
  peopleOnly: true,
  input: AddNoteInput,
  output: NoteDto,
  auditFields: [],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    if (input.opportunityId === undefined) {
      const account = await readableAccount(ctx, input.accountId, input.entityId);
      const [scope] = (await ctx.tx.execute(
        sql`select app.account_in_scope(${account.id}::uuid, 'crm.account.write') as writable`,
      )) as unknown as { writable: boolean }[];
      if (scope?.writable !== true) throw denied(`account ${account.id}`);
    } else {
      await holdCustomer(ctx, input.accountId);
      const o = schema.opportunities;
      const [lead] = await ctx.tx
        .select({
          id: o.id,
          writable: sql<boolean>`app.scope_ok('crm.lead.write', ${o.ownerId}, ${o.teamId})`,
        })
        .from(o)
        .where(
          and(
            eq(o.id, input.opportunityId),
            eq(o.entityId, input.entityId),
            eq(o.accountId, input.accountId),
            isNull(o.archivedAt),
          ),
        )
        .limit(1);
      if (!lead) {
        throw new DomainError('not_found', `opportunity ${input.opportunityId} is not visible`, {
          reason: 'lead_missing',
        });
      }
      if (!lead.writable) throw denied(`opportunity ${lead.id}`);
    }
    await ctx.activity({
      type: 'note',
      accountId: input.accountId,
      opportunityId: input.opportunityId ?? null,
      entityId: input.entityId,
      body: input.body,
    });
    return { accountId: input.accountId, opportunityId: input.opportunityId ?? null };
  },
});
