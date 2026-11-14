import {
  DialReadinessDto,
  DomainError,
  DueCallRecordingDto,
  ProviderCallForReportDto,
  ProviderCallRefInput,
  UnplacedProviderCallDto,
  type ProviderCallDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { toProviderCallDto } from '../../commands/calls/provider-calls';

// The reads of click-to-dial (docs/03-roadmap-appendix/phase2.md §6.3): what the workspaces ask
// before offering the Dial key, the call bar's call, and the platform's lookups for the status
// handler and the hourly sweep, each through the definer that checks `calls.process`.

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

function inRequest(ctx: Ctx, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/**
 * Whether the company has a 140 or 160 calling number in use, and whether the caller has set their
 * own dial phone there, for a person holding `calls.dial`. Whether the runtime has a provider is
 * the web app's to add.
 */
export async function dialReadiness(
  ctx: Ctx,
  entityId: number,
): Promise<{ companyHasNumbers: boolean; dialPhoneSet: boolean }> {
  checkPermission(ctx.principal, 'calls.dial', 'own');
  inRequest(ctx, entityId);
  const ec = schema.entityChannels;
  const cp = schema.callerProfiles;
  const [numbers] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(ec)
    .where(
      and(
        eq(ec.entityId, entityId),
        eq(ec.isActive, true),
        inArray(ec.channel, ['call_promo_140', 'call_service_160']),
      ),
    );
  const [profile] = await ctx.tx
    .select({ phone: cp.dialPhoneE164 })
    .from(cp)
    .where(and(eq(cp.userId, ctx.principal.id), eq(cp.entityId, entityId)))
    .limit(1);
  return {
    companyHasNumbers: (numbers?.n ?? 0) > 0,
    dialPhoneSet: profile?.phone != null,
  };
}

/** The workspace's answer, once the web app knows whether a provider is set up. */
export function toDialReadiness(
  facts: { companyHasNumbers: boolean; dialPhoneSet: boolean },
  providerSetUp: boolean,
): DialReadinessDto {
  return DialReadinessDto.parse({
    available: providerSetUp && facts.companyHasNumbers,
    dialPhoneSet: facts.dialPhoneSet,
  });
}

/** The caller's own dial phone in a company, or null; for their profile. */
export async function ownDialPhone(ctx: Ctx, entityId: number): Promise<string | null> {
  checkPermission(ctx.principal, 'calls.dial', 'own');
  inRequest(ctx, entityId);
  const cp = schema.callerProfiles;
  const [row] = await ctx.tx
    .select({ phone: cp.dialPhoneE164 })
    .from(cp)
    .where(and(eq(cp.userId, ctx.principal.id), eq(cp.entityId, entityId)))
    .limit(1);
  return row?.phone ?? null;
}

/**
 * One provider call of the caller's own, as their call bar reads it again while the provider
 * reports; a call of someone else, of another company or one the caller cannot read is not found.
 */
export async function ownProviderCall(ctx: Ctx, rawInput: ProviderCallRefInput): Promise<ProviderCallDto> {
  const input = ProviderCallRefInput.parse(rawInput);
  checkPermission(ctx.principal, 'calls.dial', 'own');
  inRequest(ctx, input.entityId);
  const pc = schema.providerCalls;
  const [row] = await ctx.tx
    .select()
    .from(pc)
    .where(
      and(
        eq(pc.id, input.providerCallId),
        eq(pc.entityId, input.entityId),
        eq(pc.callerId, ctx.principal.id),
      ),
    )
    .limit(1);
  if (row === undefined) {
    throw new DomainError('not_found', `provider call ${input.providerCallId} is not visible`, {
      reason: 'provider_call_missing',
    });
  }
  return toProviderCallDto(row);
}

/**
 * The platform's lookup of a reported call (`calls.process`), by the id the signed callback
 * address carried: its company, status, provider id and whether it has a recording; undefined
 * when there is no such call or it holds another provider id.
 */
export async function providerCallForReport(
  ctx: Pick<RequestContext, 'tx'>,
  providerCallId: string,
  callSid: string | null,
): Promise<ProviderCallForReportDto | undefined> {
  const rows = (await ctx.tx.execute(sql`
    select entity_id, status, provider_call_sid, has_recording
      from app.provider_call_for_report(${providerCallId}::uuid, ${callSid}::text)`)) as unknown as {
    entity_id: number;
    status: string;
    provider_call_sid: string | null;
    has_recording: boolean;
  }[];
  const [row] = rows;
  return row === undefined
    ? undefined
    : ProviderCallForReportDto.parse({
        entityId: row.entity_id,
        status: row.status,
        providerCallSid: row.provider_call_sid,
        hasRecording: row.has_recording,
      });
}

/** The request's companies' dials never taken nor reported that started before `before`. */
export async function unplacedProviderCalls(
  ctx: Pick<RequestContext, 'tx'>,
  before: Date,
  limit: number,
): Promise<UnplacedProviderCallDto[]> {
  const rows = (await ctx.tx.execute(sql`
    select id, entity_id from app.unplaced_provider_calls(${before.toISOString()}::timestamptz, ${limit}::integer)`)) as unknown as {
    id: string;
    entity_id: number;
  }[];
  return rows.map((r) => UnplacedProviderCallDto.parse({ id: r.id, entityId: r.entity_id }));
}

/** The request's companies' call recordings still stored and made before `before`, oldest first. */
export async function dueCallRecordings(
  ctx: Pick<RequestContext, 'tx'>,
  before: Date,
  limit: number,
): Promise<DueCallRecordingDto[]> {
  const rows = (await ctx.tx.execute(sql`
    select file_id, entity_id, bucket, key
      from app.call_recordings_due(${before.toISOString()}::timestamptz, ${limit}::integer)`)) as unknown as {
    file_id: string;
    entity_id: number;
    bucket: string;
    key: string;
  }[];
  return rows.map((r) =>
    DueCallRecordingDto.parse({
      fileId: r.file_id,
      entityId: r.entity_id,
      bucket: r.bucket,
      key: r.key,
    }),
  );
}

/**
 * Of the provider calls named, those whose kept recording the reader may play
 * (`app.playable_recordings()`), each with its company; empty for a reader without
 * `calls.recording.listen`.
 */
export async function playableRecordings(
  ctx: Pick<RequestContext, 'tx'>,
  providerCallIds: readonly string[],
): Promise<Map<string, number>> {
  if (providerCallIds.length === 0) return new Map();
  const ids = `{${[...new Set(providerCallIds)].slice(0, 200).join(',')}}`;
  const rows = (await ctx.tx.execute(sql`
    select provider_call_id, entity_id from app.playable_recordings(${ids}::uuid[])`)) as unknown as {
    provider_call_id: string;
    entity_id: number;
  }[];
  return new Map(rows.map((r) => [r.provider_call_id, r.entity_id]));
}
