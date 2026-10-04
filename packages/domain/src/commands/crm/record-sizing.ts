import {
  DomainError,
  newId,
  RecordSizingInput,
  SizingDto,
  type PumpType,
  type SizingKind,
  type SizingReason,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import type { Bounded } from '../../sizing/bounds';
import { pumpSpecsOf } from '../../sizing/pump-specs';
import { SIZING_ENGINE_VERSION, sizePump, sizeRooftop, type ChosenPump } from '../../sizing/size';
import { transition } from '../../state-machines/define-machine';
import { taskMachine } from '../../state-machines/machines/task';
import { requireEntity } from './opportunity-shared';

/** The lead a sizing is recorded on, as the caller reads it. */
interface Lead {
  id: string;
  entityId: number;
  accountId: string;
  siteId: string | null;
}

async function readLead(
  ctx: CommandContext,
  input: { entityId: number; opportunityId: string },
): Promise<Lead> {
  const o = schema.opportunities;
  const [lead] = await ctx.tx
    .select({ id: o.id, entityId: o.entityId, accountId: o.accountId, siteId: o.siteId })
    .from(o)
    .where(and(eq(o.id, input.opportunityId), eq(o.entityId, input.entityId), isNull(o.archivedAt)))
    .limit(1);
  if (!lead) {
    throw new DomainError('not_found', `opportunity ${input.opportunityId} is not visible`, {
      reason: 'lead_missing',
    });
  }
  return lead;
}

/**
 * The chosen pump: its curve, head and flow as numbers, lowest head first, and its rated HP from
 * its specifications. The item must be in the catalogue and on sale, and a pump whose
 * specifications name a type other than the sizing's (a surface pump for a borewell) is refused,
 * since its curve answers a different question; a pump with no type given is taken as it is. A
 * pump with fewer than two points is judged by the calculator (`curve_too_short`), not refused,
 * so the panel can say why.
 */
async function chosenPump(
  ctx: CommandContext,
  itemId: string,
  pumpType: PumpType,
): Promise<ChosenPump> {
  const i = schema.items;
  const [item] = await ctx.tx
    .select({ id: i.id, specs: i.specsJson })
    .from(i)
    .where(and(eq(i.id, itemId), eq(i.isActive, true), isNull(i.archivedAt)))
    .limit(1);
  if (!item) {
    throw new DomainError('not_found', `item ${itemId} is not on sale`, {
      reason: 'sizing_item_missing',
    });
  }
  const specs = pumpSpecsOf(item.specs);
  if (specs.pumpType !== null && specs.pumpType !== pumpType) {
    throw new DomainError('validation_failed', `item ${itemId} is a ${specs.pumpType} pump`, {
      reason: 'sizing_pump_type_mismatch',
    });
  }
  const pc = schema.pumpCurves;
  const points = await ctx.tx
    .select({ headM: pc.headM, flowLph: pc.flowLph })
    .from(pc)
    .where(eq(pc.itemId, itemId))
    .orderBy(asc(pc.headM));
  return {
    curve: points.map((p) => ({ headM: Number(p.headM), flowLph: Number(p.flowLph) })),
    ratedHp: specs.ratedHp,
  };
}

/**
 * `crm.sizing.record` (docs/design/phase1.md §6.7, PRD SAL-04): runs the sizing calculators on
 * the field measurements and stores the inputs, the result, its bounds and the engine version as
 * a new row of the lead's history (the newest is the one a quote uses). The result is always
 * computed here from the inputs and the workshop defaults; a caller never supplies it. Any person
 * who may write the lead may size it: the insert policy checks `crm.lead.write` on the lead's
 * owner and team, and that the recorder is a user principal. Only people record the sizing a quote
 * relies on (the owner's decision of 30-09-2026, SECURITY §3.3): the guard refuses agents, voice
 * sessions and the system principal (`people_only`). An out-of-bounds result is recorded, not
 * refused, with the reasons the quote guard names, and opens a review task for the lead's team
 * lead (`openReview`). Each sizing is a row of the customer's timeline (`sizing_recorded`).
 */
export const recordSizing = defineCommand({
  name: 'crm.sizing.record',
  permission: 'crm.lead.write',
  minScope: 'own',
  peopleOnly: true,
  input: RecordSizingInput,
  output: SizingDto,
  auditFields: [
    'sizingKind',
    'inBounds',
    'sizingReasons',
    'engineVersion',
    'taskKind',
    'dueAt',
    'state',
  ],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const lead = await readLead(ctx, input);
    const { sizing } = input;
    if (sizing.kind === 'pump') {
      const pump =
        sizing.itemId === null
          ? null
          : await chosenPump(ctx, sizing.itemId, sizing.inputs.pumpType);
      const { result, ...bounds } = sizePump(sizing.inputs, pump);
      const stored = await store(ctx, lead, {
        kind: 'pump',
        itemId: sizing.itemId,
        inputs: sizing.inputs,
        result,
        ...bounds,
      });
      return {
        ...stored,
        kind: 'pump' as const,
        itemId: sizing.itemId,
        inputs: sizing.inputs,
        result,
      };
    }
    const { result, ...bounds } = sizeRooftop(sizing.inputs);
    const stored = await store(ctx, lead, {
      kind: 'rooftop',
      itemId: null,
      inputs: sizing.inputs,
      result,
      ...bounds,
    });
    return { ...stored, kind: 'rooftop' as const, itemId: null, inputs: sizing.inputs, result };
  },
});

/** One sizing as the calculators gave it, ready to store. */
interface Computed extends Bounded {
  kind: SizingKind;
  itemId: string | null;
  inputs: unknown;
  result: unknown;
}

/**
 * Stores the sizing as a new row of the lead's history with the lead's site, audits it and sends
 * `crm.sizing.recorded` (ids and codes only). Answers the fields every sizing DTO shares.
 */
async function store(ctx: CommandContext, lead: Lead, sizing: Computed) {
  const id = newId();
  const reasons: SizingReason[] = [...sizing.reasons];
  await ctx.tx.insert(schema.sizings).values({
    id,
    entityId: lead.entityId,
    opportunityId: lead.id,
    siteId: lead.siteId,
    kind: sizing.kind,
    itemId: sizing.itemId,
    inputsJson: sizing.inputs,
    resultJson: sizing.result,
    inBounds: sizing.inBounds,
    reasonsJson: reasons,
    engineVersion: SIZING_ENGINE_VERSION,
    createdAt: ctx.now,
    createdBy: ctx.principal.id,
  });
  ctx.audit({
    aggregateType: 'sizing',
    aggregateId: id,
    entityId: lead.entityId,
    after: {
      opportunityId: lead.id,
      itemId: sizing.itemId,
      sizingKind: sizing.kind,
      inBounds: sizing.inBounds,
      sizingReasons: reasons,
      engineVersion: SIZING_ENGINE_VERSION,
    },
  });
  ctx.emit({
    type: 'crm.sizing.recorded',
    entityId: lead.entityId,
    aggregateType: 'sizing',
    aggregateId: id,
    payload: { opportunityId: lead.id, kind: sizing.kind, inBounds: sizing.inBounds, reasons },
  });
  await ctx.activity({
    type: 'sizing_recorded',
    opportunityId: lead.id,
    accountId: lead.accountId,
    entityId: lead.entityId,
    payload: { sizingId: id, kind: sizing.kind, inBounds: sizing.inBounds },
  });
  if (!sizing.inBounds) await openReview(ctx, lead, id);
  return {
    id,
    entityId: lead.entityId,
    opportunityId: lead.id,
    siteId: lead.siteId,
    inBounds: sizing.inBounds,
    reasons,
    engineVersion: SIZING_ENGINE_VERSION,
    createdAt: ctx.now.toISOString(),
  };
}

/** What `app.open_sizing_review()` answers when the lead's team has a lead. */
interface ReviewRow {
  task_id: string;
  assignee_id: string;
  team_id: string;
  opened: boolean;
}

/**
 * An out-of-bounds sizing asks the lead's team lead to review it (docs/design/phase1.md §6.7): a
 * `review` task on the lead, due now, for the active person with the Sales Team Lead role on the
 * lead's team, never the recorder. The recorder may not write a task for someone else, so the
 * definer `app.open_sizing_review()` writes this one task after checking the sizing is the
 * caller's own, out of bounds, on a lead the caller may write; the task machine's `create` is
 * checked first, as `crm.task.create` does. Nothing is opened for a lead with no team or a team
 * with no other lead, and an open review of the lead for that person stands for the new sizing
 * too. A task opened here is audited and put on the timeline as `crm.task.create` does.
 */
async function openReview(ctx: CommandContext, lead: Lead, sizingId: string): Promise<void> {
  const dueAt = ctx.now;
  transition(taskMachine, { state: null }, 'create', {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params: { dueAt },
  });
  const rows = (await ctx.tx.execute(
    sql`select task_id, assignee_id, team_id, opened
          from app.open_sizing_review(${sizingId}::uuid, ${newId()}::uuid, ${dueAt.toISOString()}::timestamptz)`,
  )) as unknown as ReviewRow[];
  const review = rows[0];
  if (!review?.opened) return;
  ctx.audit({
    aggregateType: 'task',
    aggregateId: review.task_id,
    entityId: lead.entityId,
    after: {
      opportunityId: lead.id,
      assigneeId: review.assignee_id,
      teamId: review.team_id,
      taskKind: 'review',
      dueAt: dueAt.toISOString(),
      state: 'open',
    },
  });
  await ctx.activity({
    type: 'task_created',
    opportunityId: lead.id,
    accountId: lead.accountId,
    entityId: lead.entityId,
    payload: {
      taskId: review.task_id,
      kind: 'review',
      dueAt: dueAt.toISOString(),
      assigneeId: review.assignee_id,
    },
  });
}
