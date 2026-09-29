import {
  ApprovePriceListInput,
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

/** The approved list of a series that prices `today`, if there is one. */
async function liveListId(
  ctx: CommandContext,
  tierId: string,
  entityId: number | null,
  today: string,
): Promise<string | undefined> {
  const [row] = await ctx.tx
    .select({ id: pl.id })
    .from(pl)
    .where(
      and(
        sameSeries(tierId, entityId),
        isNull(pl.archivedAt),
        isNotNull(pl.approvedBy),
        lte(pl.effectiveFrom, today),
        or(isNull(pl.effectiveTo), gt(pl.effectiveTo, today)),
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
 * group, from today or a later date, holding a copy of the prices live today (the company's own
 * list of the tier, else the group's) for items and kits still sold. Setting its prices goes
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
    const [last] = await ctx.tx
      .select({ version: sql<number>`coalesce(max(${pl.version}), 0)::int` })
      .from(pl)
      .where(sameSeries(tier.id, entityId));
    const version = (last?.version ?? 0) + 1;
    const copiedFromId =
      (await liveListId(ctx, tier.id, entityId, today)) ??
      (entityId === null ? undefined : await liveListId(ctx, tier.id, null, today));

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
  constraintReasons: { price_lists_no_overlap: 'price_list_overlap' },
  async handler(ctx, input) {
    const today = istCalendarDate(ctx.now);
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

    // Every approved list of the series, locked: two approvals of one series take turns.
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
