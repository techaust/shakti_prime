import {
  CancelForOrderDto,
  CancelForOrderInput,
  PROJECT_ORDER_CANCELLED_REASON,
  ProjectStateSchema,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { transition } from '../../state-machines/define-machine';
import { projectStandardMachine } from '../../state-machines/machines/project-standard';
import { requireEntity } from '../crm/opportunity-shared';

interface OrderProjectRow {
  project_id: string;
  account_id: string;
  state: string;
  flow: string;
  steps_done: number;
}

/**
 * `projects.project.cancel_for_order` (docs/03-roadmap-appendix/phase4.md §6.1, J1 review 2): the
 * platform's answer to `sales.order.cancelled`, run by the event worker as `system:workers` with
 * the platform-only `projects.draft`, which reads and moves the project only through
 * `app.order_cancelled_project()` and `app.cancel_order_project()` (ADR 0020).
 *
 * A standard project in progress or on hold with none of its steps done is cancelled with the
 * reason `PROJECT_ORDER_CANCELLED_REASON` (the `project_standard` machine's `cancel`, fired by the
 * platform). A project with a step done, a completed one, or a PM Surya Ghar project (whose flow
 * J4 drives) is kept, and `projects.project.order_cancelled` tells its Project Manager to close
 * it. A repeat delivery finds the project cancelled, or tells nobody twice (the notice is one per
 * project), so it changes nothing.
 */
export const cancelForOrder = defineCommand({
  name: 'projects.project.cancel_for_order',
  permission: 'projects.draft',
  minScope: 'entity',
  input: CancelForOrderInput,
  output: CancelForOrderDto,
  // The reason is the platform's own code, which the action's name already says in words.
  auditFields: ['projectState'],
  // Run for every cancelled order: a call that changed nothing leaves no audit row.
  auditWhen: 'changed',
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const [row] = (await ctx.tx.execute(
      sql`select project_id, account_id, state, flow, steps_done
            from app.order_cancelled_project(${input.entityId}::smallint, ${input.orderId}::uuid)`,
    )) as unknown as OrderProjectRow[];
    if (row === undefined) return { outcome: 'none' as const };
    const state = ProjectStateSchema.parse(row.state);
    const cancellable =
      row.flow === 'standard' &&
      row.steps_done === 0 &&
      (state === 'active' || state === 'on_hold');
    if (cancellable) {
      transition(projectStandardMachine, { state, milestones: [] }, 'cancel', {
        actor: { kind: 'system', job: 'project-order-cancelled' },
        now: ctx.now,
        params: { reason: PROJECT_ORDER_CANCELLED_REASON },
      });
      const [done] = (await ctx.tx.execute(
        sql`select app.cancel_order_project(${input.entityId}::smallint, ${row.project_id}::uuid,
                                            ${PROJECT_ORDER_CANCELLED_REASON},
                                            ${ctx.now.toISOString()}::timestamptz) as cancelled`,
      )) as unknown as { cancelled: boolean }[];
      if (done?.cancelled === true) {
        ctx.audit({
          aggregateType: 'project',
          aggregateId: row.project_id,
          entityId: input.entityId,
          before: { projectState: state },
          after: { projectState: 'cancelled' },
        });
        ctx.emit({
          type: 'projects.project.cancelled',
          entityId: input.entityId,
          aggregateType: 'project',
          aggregateId: row.project_id,
          payload: { accountId: row.account_id },
        });
        return { outcome: 'cancelled' as const, projectId: row.project_id };
      }
    }
    ctx.emit({
      type: 'projects.project.order_cancelled',
      entityId: input.entityId,
      aggregateType: 'project',
      aggregateId: row.project_id,
      payload: { accountId: row.account_id, salesOrderId: input.orderId },
    });
    return { outcome: 'kept' as const, projectId: row.project_id };
  },
});
