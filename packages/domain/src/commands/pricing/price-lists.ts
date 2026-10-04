import {
  ApprovePriceListInput,
  ArchivePriceListInput,
  CreatePriceListInput,
  DomainError,
  newId,
  PriceListDto,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, isNotNull, isNull, lte, ne, or, gt, sql, type SQL } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { istCalendarDate } from '../../numbering/financial-year';
import { toPriceListDto, type PriceListFacts } from '../../queries/pricing/list-state';
import { eventEntity } from '../catalogue/shared';

const pl = schema.priceLists;

/** Lists of one tier for one company, or the group's lists when `entityId` is null. */
const sameSeries = (tierId: string, entityId: number | null): SQL | undefined =>
  and(eq(pl.tierId, tierId), entityId === null ? isNull(pl.entityId) : eq(pl.entityId, entityId));

/** A list for the whole group prices every company: only a request for every company may write it. */
async function assertGroupScope(ctx: CommandContext, entityId: number | null): Promise<void> {
  if (entityId !== null) {
    if (!ctx.entityIds.includes(entityId)) {
      throw new DomainError('forbidden', 'company outside the request scope', { entityId });
    }
    return;
  }
  const covered = (await ctx.tx.execute(
    sql`select app.request_covers_group() as ok`,
  )) as unknown as { ok: boolean }[];
  if (covered[0]?.ok !== true) {
    throw new DomainError('forbidden', 'a shared price list needs every company in scope', {
      reason: 'price_list_group_scope',
    });
  }
}

/**
 * Makes the changes to one series (a tier for one company, or for the group) take turns: a
 * transaction-scoped lock keyed by the tier and company, taken before the series is read, so two
 * approvals, archives or new versions of one series never work from the same picture of it.
 */
async function lockSeries(ctx: CommandContext, tierId: string, entityId: number | null) {
  const key = `price_list_series:${tierId}:${entityId === null ? 'group' : String(entityId)}`;
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** The calendar day before `date` (`YYYY-MM-DD`). */
export function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** The approved list of a series that prices `day`, if there is one. */
async function listInForce(
  ctx: CommandContext,
  tierId: string,
  entityId: number | null,
  day: string,
): Promise<string | undefined> {
  const [row] = await ctx.tx
    .select({ id: pl.id })
    .from(pl)
    .where(
      and(
        sameSeries(tierId, entityId),
        isNull(pl.archivedAt),
        isNotNull(pl.approvedBy),
        lte(pl.effectiveFrom, day),
        or(isNull(pl.effectiveTo), gt(pl.effectiveTo, day)),
      ),
    )
    .limit(1);
  return row?.id;
}

async function readList(ctx: CommandContext, id: string): Promise<PriceListFacts> {
  const [row] = await ctx.tx
    .select({
      id: pl.id,
      tierCode: schema.priceTiers.code,
      tierName: schema.priceTiers.name,
      entityId: pl.entityId,
      version: pl.version,
      effectiveFrom: pl.effectiveFrom,
      effectiveTo: pl.effectiveTo,
      approvedAt: pl.approvedAt,
      archivedAt: pl.archivedAt,
    })
    .from(pl)
    .innerJoin(schema.priceTiers, eq(schema.priceTiers.id, pl.tierId))
    .where(eq(pl.id, id))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `price list ${id} is not visible`, {
      reason: 'price_list_missing',
    });
  }
  return row;
}

/**
 * `pricing.list.create` (SAL-01): a draft version of a tier's price list for one company or the
 * group, from today or a later date, holding a copy of the prices that will be in force on the
 * day before it starts (the company's own list of the tier then, else the group's), for items and
 * kits still sold, so a list scheduled in between is its starting point. Setting its prices goes
 * through `pricing.price.set`; it prices nothing until `pricing.list.approve`.
 */
export const createPriceList = defineCommand({
  name: 'pricing.list.create',
  permission: 'pricing.write',
  minScope: 'entity',
  input: CreatePriceListInput,
  output: PriceListDto,
  auditFields: ['tierCode', 'version', 'effectiveFrom', 'prices'],
  constraintReasons: { price_lists_tier_entity_version_unique: 'price_list_version_taken' },
  async handler(ctx, input) {
    const today = istCalendarDate(ctx.now);
    if (input.effectiveFrom < today) {
      throw new DomainError('validation_failed', 'a price list starts today or later', {
        reason: 'price_list_start_past',
      });
    }
    const entityId = input.entityId ?? null;
    await assertGroupScope(ctx, entityId);
    const [tier] = await ctx.tx
      .select({ id: schema.priceTiers.id })
      .from(schema.priceTiers)
      .where(
        and(
          eq(schema.priceTiers.code, input.tierCode),
          eq(schema.priceTiers.isActive, true),
          isNull(schema.priceTiers.archivedAt),
        ),
      )
      .limit(1);
    if (!tier) {
      throw new DomainError('not_found', `price tier ${input.tierCode} is not in use`, {
        reason: 'price_tier_missing',
      });
    }
    await lockSeries(ctx, tier.id, entityId);
    const [last] = await ctx.tx
      .select({ version: sql<number>`coalesce(max(${pl.version}), 0)::int` })
      .from(pl)
      .where(sameSeries(tier.id, entityId));
    const version = (last?.version ?? 0) + 1;
    const eve = dayBefore(input.effectiveFrom);
    const copiedFromId =
      (await listInForce(ctx, tier.id, entityId, eve)) ??
      (entityId === null ? undefined : await listInForce(ctx, tier.id, null, eve));

    const id = newId();
    await ctx.tx.insert(pl).values({
      id,
      tierId: tier.id,
      entityId,
      version,
      effectiveFrom: input.effectiveFrom,
      createdBy: ctx.principal.id,
    });
    let prices = 0;
    if (copiedFromId !== undefined) {
      // The copy is logged as each price's first value on the new list, with no reason.
      await ctx.tx.execute(sql`select set_config('app.price_reason', '', true)`);
      const copied = (await ctx.tx.execute(sql`
        with copied as (
          insert into price_list_items (id, price_list_id, item_id, kit_id, price, created_by)
          select app.uuid_v7(), ${id}, s.item_id, s.kit_id, s.price, ${ctx.principal.id}
            from price_list_items s
            left join items i on i.id = s.item_id
            left join kits k on k.id = s.kit_id
           where s.price_list_id = ${copiedFromId}
             and ((i.id is not null and i.is_active and i.archived_at is null)
               or (k.id is not null and k.is_active and k.archived_at is null))
          returning 1)
        select count(*)::int as n from copied`)) as unknown as { n: number }[];
      prices = copied[0]?.n ?? 0;
    }

    const list = await readList(ctx, id);
    ctx.audit({
      aggregateType: 'price_list',
      aggregateId: id,
      entityId,
      before: null,
      after: {
        tierCode: input.tierCode,
        version,
        effectiveFrom: input.effectiveFrom,
        copiedFromId: copiedFromId ?? null,
        prices,
      },
    });
    ctx.emit({
      type: 'pricing.list.created',
      entityId: entityId ?? eventEntity(ctx),
      aggregateType: 'price_list',
      aggregateId: id,
      payload: { tierCode: input.tierCode, copiedFromId: copiedFromId ?? null, prices },
    });
    return toPriceListDto(list, today);
  },
});

/**
 * `pricing.list.approve` (SAL-01): a draft becomes its tier's list from its start date, which
 * must not have passed. The approved list pricing that date ends where the draft starts; the
 * draft itself ends where a later approved list of the series starts. Quotes read approved lists
 * only. Records who approved it and when.
 */
export const approvePriceList = defineCommand({
  name: 'pricing.list.approve',
  permission: 'pricing.write',
  minScope: 'entity',
  input: ApprovePriceListInput,
  output: PriceListDto,
  auditFields: ['approvedAt', 'effectiveTo'],
  // A clash the series lock did not prevent (a list approved outside this command) answers its
  // own reason; the same-day overlap found below answers `price_list_overlap`.
  constraintReasons: { price_lists_no_overlap: 'price_list_approval_clash' },
  async handler(ctx, input) {
    const today = istCalendarDate(ctx.now);
    await lockSeriesOf(ctx, input.priceListId);
    const [draft] = await ctx.tx
      .select({
        id: pl.id,
        tierId: pl.tierId,
        entityId: pl.entityId,
        effectiveFrom: pl.effectiveFrom,
        effectiveTo: pl.effectiveTo,
        approvedAt: pl.approvedAt,
        archivedAt: pl.archivedAt,
      })
      .from(pl)
      .where(eq(pl.id, input.priceListId))
      .limit(1)
      .for('update');
    if (!draft) {
      throw new DomainError('not_found', `price list ${input.priceListId} is not visible`, {
        reason: 'price_list_missing',
      });
    }
    if (draft.archivedAt !== null) {
      throw new DomainError('conflict', 'price list is closed', { reason: 'price_list_closed' });
    }
    if (draft.approvedAt !== null) {
      throw new DomainError('conflict', 'price list is already approved', {
        reason: 'price_list_approved',
      });
    }
    if (draft.effectiveFrom < today) {
      throw new DomainError('validation_failed', 'the start date has passed', {
        reason: 'price_list_start_past',
      });
    }
    await assertGroupScope(ctx, draft.entityId);

    // Every approved list of the series, read after the series lock and locked for the change.
    const approved = await ctx.tx
      .select({ id: pl.id, effectiveFrom: pl.effectiveFrom, effectiveTo: pl.effectiveTo })
      .from(pl)
      .where(
        and(
          sameSeries(draft.tierId, draft.entityId),
          isNull(pl.archivedAt),
          isNotNull(pl.approvedBy),
          ne(pl.id, draft.id),
        ),
      )
      .orderBy(asc(pl.effectiveFrom))
      .for('update');

    const from = draft.effectiveFrom;
    if (approved.some((a) => a.effectiveFrom === from)) {
      throw new DomainError('conflict', 'an approved list starts on the same date', {
        reason: 'price_list_overlap',
      });
    }
    const closedListIds: string[] = [];
    for (const a of approved) {
      if (a.effectiveFrom < from && (a.effectiveTo === null || a.effectiveTo > from)) {
        await ctx.tx
          .update(pl)
          .set({ effectiveTo: from, updatedBy: ctx.principal.id })
          .where(eq(pl.id, a.id));
        closedListIds.push(a.id);
        ctx.audit({
          aggregateType: 'price_list',
          aggregateId: a.id,
          entityId: draft.entityId,
          before: { effectiveTo: a.effectiveTo },
          after: { effectiveTo: from },
        });
      }
    }
    const nextStart = approved.find((a) => a.effectiveFrom > from)?.effectiveFrom;
    const effectiveTo =
      nextStart !== undefined && (draft.effectiveTo === null || draft.effectiveTo > nextStart)
        ? nextStart
        : draft.effectiveTo;

    await ctx.tx
      .update(pl)
      .set({
        approvedBy: ctx.principal.id,
        approvedAt: ctx.now,
        effectiveTo,
        updatedBy: ctx.principal.id,
      })
      .where(eq(pl.id, draft.id));
    const list = await readList(ctx, draft.id);
    ctx.audit({
      aggregateType: 'price_list',
      aggregateId: draft.id,
      entityId: draft.entityId,
      before: { approvedAt: null, effectiveTo: draft.effectiveTo },
      after: { approvedAt: ctx.now.toISOString(), effectiveTo },
    });
    ctx.emit({
      type: 'pricing.list.approved',
      entityId: draft.entityId ?? eventEntity(ctx),
      aggregateType: 'price_list',
      aggregateId: draft.id,
      payload: { tierCode: list.tierCode, closedListIds },
    });
    return toPriceListDto(list, today);
  },
});

/**
 * Takes the series lock of a list, from its tier and company, after checking the request may
 * change that series (a list for every company needs a request for every company); nothing when
 * the list is not visible, which the locked read after it reports.
 */
async function lockSeriesOf(ctx: CommandContext, priceListId: string): Promise<void> {
  const [list] = await ctx.tx
    .select({ tierId: pl.tierId, entityId: pl.entityId })
    .from(pl)
    .where(eq(pl.id, priceListId))
    .limit(1);
  if (!list) return;
  await assertGroupScope(ctx, list.entityId);
  await lockSeries(ctx, list.tierId, list.entityId);
}

/**
 * `pricing.list.archive` (SAL-01): withdraws a draft or a scheduled list, never one that prices or
 * priced anything (live or ended: `price_list_archive_in_use`). A scheduled list had ended the
 * list before it on its start date; that list takes back the end it had, so no day is left
 * unpriced.
 */
export const archivePriceList = defineCommand({
  name: 'pricing.list.archive',
  permission: 'pricing.write',
  minScope: 'entity',
  input: ArchivePriceListInput,
  output: PriceListDto,
  auditFields: ['archivedAt', 'effectiveTo'],
  async handler(ctx, input) {
    const today = istCalendarDate(ctx.now);
    await lockSeriesOf(ctx, input.priceListId);
    const [list] = await ctx.tx
      .select({
        id: pl.id,
        tierId: pl.tierId,
        entityId: pl.entityId,
        effectiveFrom: pl.effectiveFrom,
        effectiveTo: pl.effectiveTo,
        approvedAt: pl.approvedAt,
        archivedAt: pl.archivedAt,
      })
      .from(pl)
      .where(eq(pl.id, input.priceListId))
      .limit(1)
      .for('update');
    if (!list) {
      throw new DomainError('not_found', `price list ${input.priceListId} is not visible`, {
        reason: 'price_list_missing',
      });
    }
    if (list.archivedAt !== null) {
      throw new DomainError('conflict', 'price list is closed', { reason: 'price_list_closed' });
    }
    if (list.approvedAt !== null && list.effectiveFrom <= today) {
      throw new DomainError('conflict', 'a live or ended list is kept', {
        reason: 'price_list_archive_in_use',
      });
    }
    await assertGroupScope(ctx, list.entityId);

    // Withdrawn first, so the list before it may take its days back under the one-live-list rule.
    await ctx.tx
      .update(pl)
      .set({ archivedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(eq(pl.id, list.id));
    let reopenedListId: string | null = null;
    if (list.approvedAt !== null) {
      const [before] = await ctx.tx
        .select({ id: pl.id, effectiveTo: pl.effectiveTo })
        .from(pl)
        .where(
          and(
            sameSeries(list.tierId, list.entityId),
            isNull(pl.archivedAt),
            isNotNull(pl.approvedBy),
            eq(pl.effectiveTo, list.effectiveFrom),
            ne(pl.id, list.id),
          ),
        )
        .limit(1)
        .for('update');
      if (before) {
        reopenedListId = before.id;
        await ctx.tx
          .update(pl)
          .set({ effectiveTo: list.effectiveTo, updatedBy: ctx.principal.id })
          .where(eq(pl.id, before.id));
        ctx.audit({
          aggregateType: 'price_list',
          aggregateId: before.id,
          entityId: list.entityId,
          before: { effectiveTo: before.effectiveTo },
          after: { effectiveTo: list.effectiveTo },
        });
      }
    }
    const archived = await readList(ctx, list.id);
    ctx.audit({
      aggregateType: 'price_list',
      aggregateId: list.id,
      entityId: list.entityId,
      before: { archivedAt: null },
      after: { archivedAt: ctx.now.toISOString() },
    });
    ctx.emit({
      type: 'pricing.list.archived',
      entityId: list.entityId ?? eventEntity(ctx),
      aggregateType: 'price_list',
      aggregateId: list.id,
      payload: { tierCode: archived.tierCode, reopenedListId },
    });
    return toPriceListDto(archived, today);
  },
});
