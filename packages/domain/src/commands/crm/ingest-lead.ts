import {
  CustomerLanguageSchema,
  DomainError,
  LeadIngestInput,
  LeadIngestResultDto,
  REPEAT_ENQUIRY_DAYS,
  SegmentSchema,
  type AccountType,
  type CallerPresence,
  type CustomerLanguage,
  type IngestAssignee,
  type Segment,
  type SiteType,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { pickCaller, type CallerCandidate } from '../../crm/handover';
import { emitLeadCreated } from '../../crm/lead-events';
import { loadScoreRules, scoreChanged, writeRefreshedScores } from '../../crm/lead-scoring';
import { scoreLead } from '../../crm/score';
import { transition } from '../../state-machines/define-machine';
import { opportunityMachine } from '../../state-machines/machines/opportunity';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { lockNewNumber } from './create-lead';
import { requireEntity } from './opportunity-shared';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What a new customer from an integration is, by the business line of the lead: a farm for
 * pumps, a household for rooftop solar, a business otherwise. A dealer is made only by an
 * Executive (DOM-1), never from a form.
 */
const ACCOUNT_TYPE: Record<Segment, AccountType> = {
  farmer_pumps: 'farm',
  residential_rooftop: 'household',
  commercial_epc: 'business',
  dealer_wholesale: 'business',
};

/** The site a form's village or PIN describes, by business line; a dealer's enquiry has none. */
const SITE_TYPE: Record<Segment, SiteType | null> = {
  farmer_pumps: 'borewell',
  residential_rooftop: 'rooftop',
  commercial_epc: 'factory',
  dealer_wholesale: null,
};

interface PipelineRow {
  pipeline_id: string;
  pipeline_key: string;
  segment: string;
}

interface CustomerRow {
  account_id: string;
  contact_id: string;
  contact_phone_id: string;
  holder_id: string | null;
  holder_works: boolean;
  lead_id: string | null;
  lead_owner_id: string | null;
  language: string | null;
}

interface CandidateRow {
  user_id: string;
  presence: string;
  max_open: number | null;
  languages: string[];
  segments: string[];
  open_leads: number;
  last_given_at: Date | string | null;
}

interface WriteRow {
  outcome: 'created' | 'attached';
  opportunity_id: string;
  account_id: string;
  contact_id: string;
  contact_phone_id: string;
  owner_id: string | null;
  team_id: string | null;
  inbox_item_id: string | null;
  consent_ids: string[];
  site_district: string | null;
  pipeline_key: string;
  source_code: string;
}

/** Who a new lead goes to, and how. */
interface Owner {
  ownerId: string | null;
  assignedTo: IngestAssignee;
}

/**
 * The argument of `app.ingest_lead_write()`: the checked input with what the command decided (the
 * customer found, the lead joined, the owner, the account and site types). Built here only.
 */
export interface IngestWriteArgs {
  mode: 'attach' | 'create';
  channel: LeadIngestInput['channel'];
  sourceId: string | null;
  pipelineKey: string | null;
  leadId: string | null;
  accountId: string | null;
  contactId: string | null;
  contactPhoneId: string | null;
  ownerId: string | null;
  /** Routed work for the owner: the Sales Team Lead, or the colleague who has the customer. */
  routeWork: boolean;
  accountType: AccountType;
  contact: { name: string; phone: string; preferredLanguage: CustomerLanguage };
  site: { type: SiteType; village: string | null; pin: string | null } | null;
  consent: LeadIngestInput['consent'] | null;
  attribution: LeadIngestInput['attribution'] | null;
  qualification: LeadIngestInput['qualification'] | null;
  message: string | null;
}

/** The lead's pipeline in the company: the connected source's, else the one the input names. */
async function ingestPipeline(
  ctx: CommandContext,
  input: LeadIngestInput,
): Promise<{ key: string; segment: Segment }> {
  const [row] = (await ctx.tx.execute(
    sql`select pipeline_id, pipeline_key, segment
          from app.ingest_pipeline(${input.entityId}::smallint, ${input.sourceId ?? null}::uuid,
                                   ${input.pipelineKey ?? null}::text)`,
  )) as unknown as PipelineRow[];
  if (row === undefined) {
    throw new DomainError(
      'validation_failed',
      input.sourceId === undefined ? 'the pipeline is not offered' : 'the source is not live',
      { reason: input.sourceId === undefined ? 'lead_pipeline_missing' : 'lead_source_missing' },
    );
  }
  return { key: row.pipeline_key, segment: SegmentSchema.parse(row.segment) };
}

/**
 * The owner of a new lead (the owner's decision on question 3 of
 * docs/03-roadmap-appendix/phase2.md): the colleague who already looks after the customer in the
 * company while they still work on leads there; else T2's weighted round-robin among the company's
 * present Cold Calling Tele-Callers (fewest open leads, ties in turn after the one the platform gave
 * a lead to last); else the company's Sales Team Lead, with routed work; else nobody, and the lead
 * waits for whoever reads the company's leads.
 */
async function chooseOwner(
  ctx: CommandContext,
  entityId: number,
  customer: CustomerRow | undefined,
  lead: { language: CustomerLanguage; segment: Segment },
): Promise<Owner> {
  if (customer?.holder_id != null && customer.holder_works) {
    return { ownerId: customer.holder_id, assignedTo: 'customer_owner' };
  }
  const rows = (await ctx.tx.execute(
    sql`select user_id, presence, max_open, languages, segments, open_leads, last_given_at
          from app.ingest_candidates(${entityId}::smallint)`,
  )) as unknown as CandidateRow[];
  const candidates: CallerCandidate[] = rows.map((r) => ({
    userId: r.user_id,
    presence: r.presence as CallerPresence,
    maxOpen: r.max_open,
    languages: r.languages.map((l) => CustomerLanguageSchema.parse(l)),
    segments: r.segments.map((s) => SegmentSchema.parse(s)),
    openLeads: r.open_leads,
  }));
  // The person the platform gave a lead to last, so ties go round in turn after them.
  let cursor: string | null = null;
  let latest = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    const at =
      r.last_given_at === null ? Number.NEGATIVE_INFINITY : Date.parse(String(r.last_given_at));
    if (at > latest) {
      latest = at;
      cursor = r.user_id;
    }
  }
  const caller = pickCaller(candidates, lead, cursor);
  if (caller !== null) return { ownerId: caller, assignedTo: 'caller' };
  const [teamLead] = (await ctx.tx.execute(
    sql`select user_id from app.ingest_team_lead(${entityId}::smallint)`,
  )) as unknown as { user_id: string }[];
  if (teamLead !== undefined) return { ownerId: teamLead.user_id, assignedTo: 'team_lead' };
  return { ownerId: null, assignedTo: 'unassigned' };
}

/**
 * Scores a new lead with its company's rules (CRM-06), as a lead typed in is scored, through the
 * platform's scoring definer (`app.write_lead_scores()`, `crm.score.refresh`): the platform cannot
 * write a lead's columns itself. Answers the score, or undefined when no rule changes the base.
 */
async function scoreNewLead(
  ctx: CommandContext,
  args: {
    entityId: number;
    opportunityId: string;
    segment: Segment;
    sourceCode: string;
    district: string | null;
  },
): Promise<number | undefined> {
  const rules = await loadScoreRules(ctx, [args.entityId]);
  if (rules.length === 0) return undefined;
  const next = scoreLead(
    {
      entityId: args.entityId,
      segment: args.segment,
      sourceCode: args.sourceCode,
      district: args.district,
      systemSize: { kw: null, hp: null },
      createdAt: ctx.now,
    },
    rules,
    ctx.now,
  );
  // A new lead is written with the base score and no reasons.
  if (!scoreChanged({ score: WORKSHOP_DEFAULTS.crm.scoreBase, reasons: [] }, next))
    return undefined;
  const written = await writeRefreshedScores(ctx, args.entityId, [
    { id: args.opportunityId, next, seen: null },
  ]);
  if (written !== 1) throw new DomainError('internal', 'a new lead could not be scored');
  return next.score;
}

/**
 * `crm.lead.ingest` (docs/03-roadmap-appendix/phase2.md §6.2, PRD CRM-01 and CRM-02): a lead that
 * arrives from Lead Ads, a Google lead form, a company's website, or a WhatsApp message from an
 * unknown number (W1), made by the platform (`system:workers`, the platform-only
 * `crm.ingest.run`), which holds no `crm.*` permission a person may hold (ADR 0020) and so reaches
 * leads and customers only through definers that check `crm.ingest.run`.
 *
 * It does what `crm.lead.create` does for a person: the phone is normalised by the contract, the
 * site's PIN fills its tehsil and district (`customer_sites_pin_fill`), a new number is held
 * against a second lead made with it at the same moment (`lockNewNumber`), a repeat enquiry for the
 * same business line joins the customer's lead with activity in the last 30 days or in nurture
 * (`attached`), and a customer a colleague looks after in the company stays theirs: the new lead
 * goes to that colleague (the routing of a colleague's customer). Otherwise the owner is chosen by
 * `chooseOwner()`. The lead keeps its channel's source, the provider's ids as attribution, a
 * consent only when the form's mapped consent question was ticked (with the version of its
 * wording), and its qualification facts; it is scored like any new lead. Duplicate cards are left
 * to the nightly search (`crm.duplicate.scan`), as for an import.
 *
 * The caller runs it with an idempotency key made from the provider's id of the event
 * (`externalId`), so a repeated event makes nothing.
 */
export const ingestLead = defineCommand({
  name: 'crm.lead.ingest',
  permission: 'crm.ingest.run',
  minScope: 'entity',
  // A new lead is scored through the platform's scoring definer.
  alsoRequires: [{ permission: 'crm.score.refresh', minScope: 'entity' }],
  input: LeadIngestInput,
  output: LeadIngestResultDto,
  auditFields: [
    'channel',
    'outcome',
    'assignedTo',
    'existingAccount',
    'consentChannels',
    'attribution',
    'qualification',
    'score',
  ],
  unmaskedFields: [
    // The provider's own ids, long numbers by design, kept whole as attribution.
    'externalId',
    'attribution.campaignId',
    'attribution.adsetId',
    'attribution.adId',
    'attribution.formId',
    'attribution.pageId',
    'attribution.gclid',
    'attribution.ctwaClid',
    'attribution.referralSourceId',
    // A DISCOM consumer number is a long number by design.
    'qualification.discomConsumerNo',
  ],
  // The audit row keeps what the lead was made from, not the person's name, number or words.
  auditInput: (input) => ({
    entityId: input.entityId,
    channel: input.channel,
    sourceId: input.sourceId,
    pipelineKey: input.pipelineKey,
    externalId: input.externalId,
    attribution: input.attribution,
    consent: input.consent,
    qualification: input.qualification,
    site: input.site,
    message: input.message !== undefined,
  }),
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    // A lead from an integration is made by the platform (the opportunity machine's `create`).
    transition(
      opportunityMachine,
      {
        state: null,
        pipelineId: '',
        exitRequiredFields: [],
        fields: {},
        lockedUntil: null,
        stateChangedAt: null,
        hasAcceptedQuoteOrConfirmedOrder: false,
      },
      'create',
      { actor: { kind: 'system', job: 'lead-ingest' }, now: ctx.now, params: {} },
    );

    const pipeline = await ingestPipeline(ctx, input);
    const phone = input.contact.phone;
    // Held until the transaction ends, so a second lead with this number at the same moment waits
    // and then finds this one's customer.
    await lockNewNumber(ctx.tx, phone, input.entityId);
    const since = new Date(ctx.now.getTime() - REPEAT_ENQUIRY_DAYS * DAY_MS).toISOString();
    const [customer] = (await ctx.tx.execute(
      sql`select account_id, contact_id, contact_phone_id, holder_id, holder_works, lead_id,
                 lead_owner_id, language
            from app.ingest_customer(${input.entityId}::smallint, ${phone}::text,
                                     ${pipeline.segment}::text, ${since}::timestamptz)`,
    )) as unknown as CustomerRow[];

    const language =
      customer?.language != null
        ? CustomerLanguageSchema.parse(customer.language)
        : (input.contact.preferredLanguage ?? 'hinglish');
    const attach = customer?.lead_id != null;
    const owner: Owner = attach
      ? { ownerId: customer.lead_owner_id, assignedTo: 'lead_owner' }
      : await chooseOwner(ctx, input.entityId, customer, {
          language,
          segment: pipeline.segment,
        });

    const siteType = SITE_TYPE[pipeline.segment];
    const site =
      siteType !== null && (input.site?.village !== undefined || input.site?.pin !== undefined)
        ? { type: siteType, village: input.site.village ?? null, pin: input.site.pin ?? null }
        : null;
    const args: IngestWriteArgs = {
      mode: attach ? 'attach' : 'create',
      channel: input.channel,
      sourceId: input.sourceId ?? null,
      pipelineKey: input.pipelineKey ?? null,
      leadId: customer?.lead_id ?? null,
      accountId: customer?.account_id ?? null,
      contactId: customer?.contact_id ?? null,
      contactPhoneId: customer?.contact_phone_id ?? null,
      ownerId: owner.ownerId,
      routeWork: owner.assignedTo === 'team_lead' || owner.assignedTo === 'customer_owner',
      accountType: ACCOUNT_TYPE[pipeline.segment],
      contact: { name: input.contact.name, phone, preferredLanguage: language },
      site,
      consent: input.consent ?? null,
      attribution: input.attribution ?? null,
      qualification: input.qualification ?? null,
      message: input.message ?? null,
    };
    const [row] = (await ctx.tx.execute(
      sql`select outcome, opportunity_id, account_id, contact_id, contact_phone_id, owner_id,
                 team_id, inbox_item_id, consent_ids, site_district, pipeline_key, source_code
            from app.ingest_lead_write(${input.entityId}::smallint, ${JSON.stringify(args)}::jsonb)`,
    )) as unknown as WriteRow[];
    if (row === undefined) throw new DomainError('internal', 'the ingest write answered no row');

    const existingAccount = customer !== undefined;
    const score =
      row.outcome === 'created'
        ? await scoreNewLead(ctx, {
            entityId: input.entityId,
            opportunityId: row.opportunity_id,
            segment: pipeline.segment,
            sourceCode: row.source_code,
            district: row.site_district,
          })
        : undefined;

    ctx.audit({
      aggregateType: 'opportunity',
      aggregateId: row.opportunity_id,
      entityId: input.entityId,
      before: null,
      after: {
        channel: input.channel,
        outcome: row.outcome,
        sourceId: input.sourceId ?? null,
        accountId: row.account_id,
        ownerId: row.owner_id,
        assignedTo: owner.assignedTo,
        existingAccount,
        consentChannels: input.consent?.channels ?? null,
        consentIds: row.consent_ids,
        attribution: input.attribution ?? null,
        qualification: input.qualification ?? null,
        ...(score === undefined ? {} : { score }),
        ...(row.inbox_item_id === null ? {} : { inboxItemId: row.inbox_item_id }),
      },
    });

    if (row.outcome === 'created') {
      emitLeadCreated(ctx, {
        entityId: input.entityId,
        opportunityId: row.opportunity_id,
        pipelineKey: row.pipeline_key,
        sourceCode: row.source_code,
        existingAccount,
      });
    } else {
      ctx.emit({
        type: 'crm.lead.attached',
        entityId: input.entityId,
        aggregateType: 'opportunity',
        aggregateId: row.opportunity_id,
        payload: { pipelineKey: row.pipeline_key, sourceCode: row.source_code },
      });
    }
    // The colleague who looks after the customer, or the Sales Team Lead with no caller present,
    // has the lead as routed work and is told; a caller finds the new lead in their queue.
    if (row.inbox_item_id !== null && row.owner_id !== null) {
      ctx.emit({
        type: 'crm.enquiry.routed',
        entityId: input.entityId,
        aggregateType: 'inbox_item',
        aggregateId: row.inbox_item_id,
        payload: { assigneeId: row.owner_id, accountId: row.account_id },
      });
    }

    return {
      leadId: row.opportunity_id,
      entityId: input.entityId,
      accountId: row.account_id,
      contactId: row.contact_id,
      contactPhoneId: row.contact_phone_id,
      outcome: row.outcome,
      ownerId: row.owner_id,
      assignedTo: owner.assignedTo,
    };
  },
});
