import { AgentRoleKeySchema, WebhookProviderSchema } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

const Count = z.number().int().nonnegative();

/** What `app.alert_counts()` answers: counts, ids, codes and seconds only. */
const Answer = z
  .object({
    companies: z.array(
      z
        .object({ entityId: z.number().int().positive(), code: z.string(), whatsapp: z.boolean() })
        .strict(),
    ),
    webhooks: z.array(
      z
        .object({
          provider: WebhookProviderSchema,
          failedLastHour: Count,
          waiting: Count,
          oldestWaitingSeconds: Count.nullable(),
        })
        .strict(),
    ),
    agentCaps: z.array(
      z
        .object({
          // A cap of a role this build no longer knows is left for the parse below to skip.
          agent: z.string(),
          entityId: z.number().int().positive().nullable(),
          capPaise: Count,
        })
        .strict(),
    ),
    voice: z.array(
      z.object({ userId: z.uuid(), minutes: Count, spentPaise: Count }).strict(),
    ),
  })
  .strict();

/** The database's part of the Phase 2 alerts (docs/03-roadmap-appendix/phase2.md §8.1). */
export interface AlertCounts {
  companies: { entityId: number; code: string; whatsapp: boolean }[];
  webhooks: z.output<typeof Answer>['webhooks'];
  agentCaps: {
    agent: z.output<typeof AgentRoleKeySchema>;
    entityId: number | null;
    capPaise: number;
  }[];
  voice: { userId: string; minutes: number; spentPaise: number }[];
}

/**
 * The counts the hourly jobs check raises the Phase 2 alerts on, through `app.alert_counts()`,
 * which only the workers principal may call (`platform.jobs.check:all`, ADR 0020): each company's
 * code and whether it has a WhatsApp number, the webhooks per provider (failed in the last hour,
 * waiting, the oldest's wait), the agents' daily caps set on Admin › Agents, and each person's
 * voice minutes and spend today. Nothing in it names a person, a customer or a message.
 */
export async function readAlertCounts(context: Pick<RequestContext, 'tx'>): Promise<AlertCounts> {
  const rows = (await context.tx.execute(sql`select app.alert_counts() as counts`)) as unknown as {
    counts: unknown;
  }[];
  const answer = Answer.parse(rows[0]?.counts);
  return {
    companies: answer.companies,
    webhooks: answer.webhooks,
    agentCaps: answer.agentCaps.flatMap((cap) => {
      const agent = AgentRoleKeySchema.safeParse(cap.agent);
      return agent.success ? [{ ...cap, agent: agent.data }] : [];
    }),
    voice: answer.voice,
  };
}
