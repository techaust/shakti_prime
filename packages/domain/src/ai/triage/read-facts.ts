import { SegmentSchema, type Segment } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, asc, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { AGENT_DEFAULTS } from '../agent-defaults';
import type { TriageCandidate, TriageFacts, TriagePerson } from './facts';

// Reads what the Triage agent knows of one new lead (A1), as the agent itself, inside its own
// request context: every read below runs under the agent's policies (crm.lead.read and
// crm.lead.assign for its company), so it sees only what it may. It selects no name, phone number,
// address or identity number: no customer, contact or site row is read at all, and a person is
// read only as an id, a role key and their caller profile.

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

const segmentOf = (value: string): Segment | undefined => {
  const parsed = SegmentSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

/** Text values of the lead's campaign fields, the source fields an ad or a form filled in. */
function campaignFields(json: unknown): { field: string; text: string }[] {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return [];
  return Object.entries(json as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== '')
    .slice(0, 10)
    .map(([key, value]) => ({
      field: key.replace(/[^a-z0-9_]/gi, '_').slice(0, 30),
      text: value.slice(0, 500),
    }));
}

/** The facts of one open lead, or undefined when the agent cannot see it or it is not open. */
export async function readTriageFacts(
  tx: RequestTx,
  lead: { entityId: number; opportunityId: string; existingCustomer: boolean },
  now: Date,
): Promise<TriageFacts | undefined> {
  const o = schema.opportunities;
  const p = schema.pipelines;
  const st = schema.pipelineStages;
  const ls = schema.leadSources;
  const [row] = await tx
    .select({
      accountId: o.accountId,
      pipelineKey: p.key,
      segment: p.segment,
      stageKey: st.key,
      score: o.score,
      scoreReasons: o.scoreReasonsJson,
      sourceCode: ls.code,
      sourceChannel: ls.channel,
      referralPartnerId: o.referralPartnerId,
      campaign: o.campaignJson,
      createdAt: o.createdAt,
      state: o.state,
    })
    .from(o)
    .innerJoin(p, eq(p.id, o.pipelineId))
    .innerJoin(st, eq(st.id, o.stageId))
    .leftJoin(ls, eq(ls.id, o.sourceId))
    .where(
      and(eq(o.id, lead.opportunityId), eq(o.entityId, lead.entityId), isNull(o.archivedAt)),
    )
    .limit(1);
  const segment = row === undefined ? undefined : segmentOf(row.segment);
  if (row === undefined || segment === undefined || row.state !== 'open') return undefined;

  const others = await tx
    .select({ segment: p.segment, state: o.state })
    .from(o)
    .innerJoin(p, eq(p.id, o.pipelineId))
    .where(
      and(
        eq(o.accountId, row.accountId),
        eq(o.entityId, lead.entityId),
        ne(o.id, lead.opportunityId),
        isNull(o.archivedAt),
      ),
    )
    .orderBy(desc(o.createdAt))
    .limit(10);

  const pipelines = await tx
    .select({ key: p.key, segment: p.segment })
    .from(p)
    .where(
      and(
        or(isNull(p.entityId), eq(p.entityId, lead.entityId)),
        eq(p.isActive, true),
        isNull(p.archivedAt),
      ),
    )
    .orderBy(asc(p.key));

  return {
    entityId: lead.entityId,
    opportunityId: lead.opportunityId,
    pipelineKey: row.pipelineKey,
    segment,
    stageKey: row.stageKey,
    score: row.score,
    scoreFactors: scoreFactors(row.scoreReasons),
    sourceCode: row.sourceCode,
    sourceChannel: row.sourceChannel,
    referred: row.referralPartnerId !== null,
    existingCustomer: lead.existingCustomer,
    otherLeads: others.flatMap((x) => {
      const s = segmentOf(x.segment);
      return s === undefined ? [] : [{ segment: s, state: x.state }];
    }),
    createdHourIst: new Date(row.createdAt.getTime() + IST_OFFSET_MS).getUTCHours(),
    createdWeekdayIst: new Date(row.createdAt.getTime() + IST_OFFSET_MS).getUTCDay() || 7,
    pipelines: pipelines.flatMap((x) => {
      const s = segmentOf(x.segment);
      return s === undefined ? [] : [{ key: x.key, segment: s }];
    }),
    candidates: await readCandidates(tx, lead, now),
    people: await readPeople(tx, lead.entityId),
    untrusted: campaignFields(row.campaign),
  };
}

function scoreFactors(json: unknown): { factor: string; points: number }[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((r: unknown) => {
    if (r === null || typeof r !== 'object') return [];
    const { factor, points } = r as { factor?: unknown; points?: unknown };
    return typeof factor === 'string' && typeof points === 'number' ? [{ factor, points }] : [];
  });
}

/** D1's open cards of this lead and another open lead, surest first. */
async function readCandidates(
  tx: RequestTx,
  lead: { entityId: number; opportunityId: string },
  now: Date,
): Promise<TriageCandidate[]> {
  const d = schema.duplicateCandidates;
  const o = schema.opportunities;
  const otherId = sql<string>`case when ${d.opportunityId} = ${lead.opportunityId} then ${d.otherOpportunityId} else ${d.opportunityId} end`;
  const rows = await tx
    .select({
      candidateId: d.id,
      otherOpportunityId: otherId,
      confidence: d.confidence,
      otherCreatedAt: o.createdAt,
    })
    .from(d)
    .innerJoin(o, and(eq(o.id, otherId), eq(o.state, 'open'), isNull(o.archivedAt)))
    .where(
      and(
        eq(d.entityId, lead.entityId),
        eq(d.kind, 'lead'),
        eq(d.state, 'open'),
        or(eq(d.opportunityId, lead.opportunityId), eq(d.otherOpportunityId, lead.opportunityId)),
      ),
    )
    .orderBy(desc(d.confidence), asc(d.id))
    .limit(AGENT_DEFAULTS.triage.candidatesOffered);
  return rows.map((r, i) => ({
    label: `D${String(i + 1)}`,
    candidateId: r.candidateId,
    otherOpportunityId: r.otherOpportunityId,
    confidence: r.confidence,
    otherAgeDays: Math.max(0, Math.floor((now.getTime() - r.otherCreatedAt.getTime()) / DAY_MS)),
  }));
}

/**
 * The active people whose role in the company works on leads (`crm.lead.write`), as
 * `crm.opportunity.assign` accepts them, fewest open leads first, with their caller profile when the
 * agent may read it. Ids, role keys and counts only.
 */
async function readPeople(tx: RequestTx, entityId: number): Promise<TriagePerson[]> {
  const uer = schema.userEntityRoles;
  const pr = schema.principals;
  const r = schema.roles;
  const rp = schema.rolePermissions;
  const o = schema.opportunities;
  const cp = schema.callerProfiles;
  const openLeads = sql<number>`(select count(*)::int from ${o}
      where ${o.ownerId} = ${uer.userId} and ${o.entityId} = ${entityId}
        and ${o.state} = 'open' and ${o.archivedAt} is null)`;
  const rows = await tx
    .selectDistinctOn([uer.userId], {
      personId: uer.userId,
      roleKey: r.key,
      openLeads,
      converter: cp.isConverter,
      presence: cp.presence,
      maxOpen: cp.maxOpen,
      segments: cp.segments,
    })
    .from(uer)
    .innerJoin(pr, and(eq(pr.id, uer.userId), eq(pr.kind, 'user'), isNull(pr.archivedAt)))
    .innerJoin(r, eq(r.id, uer.roleId))
    .innerJoin(rp, and(eq(rp.roleId, uer.roleId), eq(rp.permissionKey, 'crm.lead.write')))
    .leftJoin(cp, and(eq(cp.userId, uer.userId), eq(cp.entityId, entityId)))
    .where(and(eq(uer.entityId, entityId), sql`app.user_is_active(${uer.userId})`))
    .orderBy(uer.userId, asc(r.key));
  const ordered = rows
    .sort((a, b) => a.openLeads - b.openLeads || (a.personId < b.personId ? -1 : 1))
    .slice(0, AGENT_DEFAULTS.triage.peopleOffered);
  return ordered.map((x, i) => ({
    label: `P${String(i + 1)}`,
    personId: x.personId,
    roleKey: x.roleKey,
    openLeads: x.openLeads,
    converter: x.converter,
    present: x.presence === null ? null : x.presence === 'present',
    maxOpen: x.maxOpen,
    segments: (x.segments ?? []).flatMap((s) => {
      const seg = segmentOf(s);
      return seg === undefined ? [] : [seg];
    }),
  }));
}
