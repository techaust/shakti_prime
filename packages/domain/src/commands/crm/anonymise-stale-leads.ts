import {
  AnonymiseStaleLeadsInput,
  LeadAnonymiseBatchDto,
  type LeadRetentionCursor,
} from '@shakti/contracts';
import type { RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { requireEntity } from './opportunity-shared';

/** How many leads one batch looks at. */
export const LEAD_RETENTION_BATCH = 500;

interface WindowRow {
  lead_id: string;
  changed_at: string;
  stale: boolean;
  kept: boolean;
}

/**
 * One batch's leads: those that may be anonymised now, those kept for good, and where the next
 * batch starts.
 */
export interface StaleWindow {
  examined: number;
  stale: string[];
  kept: string[];
  next: LeadRetentionCursor | null;
}

/**
 * The next `LEAD_RETENTION_BATCH` leads of one company not yet anonymised, not kept for good and
 * never won, whose last change is older than the retention period, oldest change first after the
 * cursor (`app.stale_leads()`), each with whether it may be anonymised now (`app.lead_is_stale()`)
 * and whether something keeps it (`app.lead_kept_reason()`).
 */
export async function readStaleWindow(
  tx: RequestTx,
  entityId: number,
  after: LeadRetentionCursor | null,
): Promise<StaleWindow> {
  const rows = (await tx.execute(
    sql`select lead_id, changed_at, stale, kept
          from app.stale_leads(${entityId}::smallint,
                               ${WORKSHOP_DEFAULTS.retention.unqualifiedLeadMonths}::integer,
                               ${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid,
                               ${LEAD_RETENTION_BATCH}::integer)`,
  )) as unknown as WindowRow[];
  const last = rows.at(-1);
  return {
    examined: rows.length,
    stale: rows.filter((row) => row.stale).map((row) => row.lead_id),
    kept: rows.filter((row) => row.kept).map((row) => row.lead_id),
    next:
      rows.length === LEAD_RETENTION_BATCH && last !== undefined
        ? { at: last.changed_at, id: last.lead_id }
        : null,
  };
}

const uuidArray = (ids: readonly string[]) => `{${ids.join(',')}}`;

/**
 * `crm.lead.anonymise` (BLUEPRINT §7.9, docs/03-roadmap-appendix/phase1.md §10): one batch of
 * one company's unqualified leads idle for `WORKSHOP_DEFAULTS.retention.unqualifiedLeadMonths`,
 * anonymised with their customers. The nightly QStash job (`apps/web/src/workers/lead-anonymise.ts`)
 * runs it batch by batch as `system:workers`, which holds the platform-only `crm.retention.run`
 * and no `crm.*` permission a person may hold (ADR 0020): it reaches leads and customers only
 * through two definers, `app.stale_leads()`, which answers the batch's leads, which are stale and
 * which are kept, and `app.anonymise_stale_leads()`, which marks the kept ones with their
 * reason, checks each customer again under lock, removes its personal details with those of all
 * its leads in every company and their audit rows, skips a customer that fails (recording it) and
 * records the batch in `retention_runs`. One audit row per anonymised lead records the time and no personal value; no
 * event is sent, since nothing waits on it.
 */
export const anonymiseStaleLeads = defineCommand({
  name: 'crm.lead.anonymise',
  permission: 'crm.retention.run',
  minScope: 'entity',
  input: AnonymiseStaleLeadsInput,
  output: LeadAnonymiseBatchDto,
  auditFields: ['anonymisedAt'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const window = await readStaleWindow(ctx.tx, input.entityId, input.after);
    const [answer] = (await ctx.tx.execute(
      sql`select app.anonymise_stale_leads(${input.entityId}::smallint,
                                           ${WORKSHOP_DEFAULTS.retention.unqualifiedLeadMonths}::integer,
                                           ${uuidArray(window.stale)}::uuid[],
                                           ${uuidArray(window.kept)}::uuid[]) as result`,
    )) as unknown as {
      result: {
        leads: { id: string; entityId: number }[];
        kept: number;
        failed: number;
        error: string | null;
      };
    }[];
    const result = answer?.result ?? { leads: [], kept: 0, failed: 0, error: null };
    const at = ctx.now.toISOString();
    for (const lead of result.leads) {
      // A lead of another company, anonymised with the customer the companies share, is
      // recorded with no company: this request is the one company's (the audit policy), and a
      // row of no company is read by those who read every company's (`audit.read:all`).
      ctx.audit({
        aggregateType: 'opportunity',
        aggregateId: lead.id,
        entityId: lead.entityId === input.entityId ? input.entityId : null,
        before: { anonymisedAt: null },
        after: { anonymisedAt: at },
      });
    }
    return LeadAnonymiseBatchDto.parse({
      entityId: input.entityId,
      examined: window.examined,
      anonymised: result.leads.length,
      kept: result.kept,
      failedCustomers: result.failed,
      next: window.next,
    });
  },
});
