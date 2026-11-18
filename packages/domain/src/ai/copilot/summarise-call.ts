import {
  CALL_TRANSCRIPT_MAX_CHARS,
  callTranscriptKey,
  DomainError,
  isRomanScript,
  newId,
  type Principal,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { executeCommand, executeQuery } from '../../command/execute';
import { attachCallTranscript } from '../../commands/calls/call-transcript';
import type { RecordingTranscriber } from '../../knowledge/index-file';
import { KnowledgeExtractError } from '../../knowledge/extract';
import { maskWholeText } from '../../knowledge/passages';
import { sha256Hex, type FileStore } from '../../ports/file-store';
import { AGENT_DEFAULTS, type CopilotCoverage } from '../agent-defaults';
import {
  copilotCeilings,
  copilotMayRun,
  copilotSettings,
  recordCopilotStop,
  runCopilot,
  type CopilotDeps,
  type CopilotRunResult,
} from './run-copilot';

// The summary of a recorded call (docs/03-roadmap-appendix/phase2.md §7.3): on
// `calls.dial.completed`, a dial of a lead that was answered and recorded, within the company's
// coverage setting (`AGENT_DEFAULTS.copilot.transcribe`, question 8 (a): Lead Converter calls only),
// is transcribed by V1's speech adapter, masked before it is stored as the call's
// `call_transcript` file (the platform's `calls.transcript.attach`), and then summarised by the
// Co-pilot (`runCopilot`). The recording is read only by the platform, through
// `app.copilot_call_facts()`; the agent reads the masked transcript alone, and the model sees it
// masked again and labelled as data.

/** What the summary worker needs of the call, as the platform reads it. */
interface CallFacts {
  opportunityId: string | null;
  direction: string;
  status: string;
  callerConverter: boolean;
  leadAnonymised: boolean;
  recording: { key: string; contentType: string; sha256: string } | null;
  transcript: { key: string; sha256: string } | null;
}

/** Why a call is not summarised; nothing is recorded for it. */
export type SummarySkip =
  /** No such call of the company, or a call with no lead (an inbound or missed call). */
  | 'not_a_dial'
  /** The call was not answered and completed, or has no recording kept. */
  | 'not_recorded'
  /** The company's coverage setting leaves this call out. */
  | 'not_covered'
  /** The lead was anonymised. */
  | 'anonymised'
  /** The recording is not a WAV, which the speech adapter reads. */
  | 'not_wav'
  /** The recording is longer than `AGENT_DEFAULTS.copilot.maxCallMinutes`. */
  | 'too_long'
  /** Nothing was heard, or the transcript was not in Roman script. */
  | 'unreadable'
  /** No speech service is set up on this runtime. */
  | 'no_speech_service';

export type SummariseResult =
  { outcome: 'skipped'; reason: SummarySkip } | (CopilotRunResult & { transcribed: boolean });

export interface SummariseDeps extends CopilotDeps {
  /** `system:workers` of the event's company, which holds `calls.process`. */
  platform: Principal;
  store: FileStore;
  /** The speech service; left out where none is set up. */
  transcriber?: RecordingTranscriber | undefined;
  hosted: boolean;
}

export interface SummariseJob {
  eventId: string;
  entityId: number;
  providerCallId: string;
}

/** The company's coverage setting (`AGENT_DEFAULTS.copilot.transcribe`). */
export function copilotCoverage(entityId: number): CopilotCoverage {
  const t = AGENT_DEFAULTS.copilot.transcribe;
  return t.byCompany[entityId] ?? t.coverage;
}

/** Whether the coverage setting takes a call by its caller. */
export function coveredCall(coverage: CopilotCoverage, callerConverter: boolean): boolean {
  if (coverage === 'all') return true;
  if (coverage === 'lead_converter') return callerConverter;
  return false;
}

const WAV_TYPES: ReadonlySet<string> = new Set(['audio/wav', 'audio/x-wav', 'audio/wave']);

async function readCallFacts(
  job: SummariseJob,
  platform: Principal,
): Promise<CallFacts | undefined> {
  return executeQuery(
    platform,
    { entityIds: [job.entityId] },
    async ({ tx }) => {
      const rows = (await tx.execute(sql`
        select opportunity_id, direction, status, caller_converter, lead_anonymised,
               recording_key, recording_content_type, recording_sha256,
               transcript_key, transcript_sha256
          from app.copilot_call_facts(${job.entityId}::smallint, ${job.providerCallId}::uuid)`)) as unknown as {
        opportunity_id: string | null;
        direction: string;
        status: string;
        caller_converter: boolean;
        lead_anonymised: boolean;
        recording_key: string | null;
        recording_content_type: string | null;
        recording_sha256: string | null;
        transcript_key: string | null;
        transcript_sha256: string | null;
      }[];
      const [row] = rows;
      if (row === undefined) return undefined;
      return {
        opportunityId: row.opportunity_id,
        direction: row.direction,
        status: row.status,
        callerConverter: row.caller_converter,
        leadAnonymised: row.lead_anonymised,
        recording:
          row.recording_key === null ||
          row.recording_content_type === null ||
          row.recording_sha256 === null
            ? null
            : {
                key: row.recording_key,
                contentType: row.recording_content_type,
                sha256: row.recording_sha256,
              },
        transcript:
          row.transcript_key === null || row.transcript_sha256 === null
            ? null
            : { key: row.transcript_key, sha256: row.transcript_sha256 },
      };
    },
    { name: 'agents.copilot.call_facts' },
  );
}

/** The bytes under `key`, checked against their SHA-256; a store that fails is retried. */
async function storedBytes(store: FileStore, key: string, sha256: string): Promise<Uint8Array> {
  const bytes = await store.get(key);
  if (bytes === undefined || sha256Hex(bytes) !== sha256) {
    throw new DomainError('integration_unavailable', `stored file ${key} could not be read`);
  }
  return bytes;
}

/**
 * Summarises one ended dial for the Co-pilot. A call outside the coverage, unanswered, unrecorded
 * or of an anonymised lead is skipped and nothing is recorded. With the Co-pilot switched off or
 * without a spending limit, one stopped run is recorded and the recording is not sent anywhere. A
 * transcript a delivery already made is read back, never paid for twice.
 */
export async function summariseCall(
  job: SummariseJob,
  deps: SummariseDeps,
): Promise<SummariseResult> {
  const call = await readCallFacts(job, deps.platform);
  if (call === undefined || call.opportunityId === null || call.direction !== 'outbound') {
    return { outcome: 'skipped', reason: 'not_a_dial' };
  }
  if (call.leadAnonymised) return { outcome: 'skipped', reason: 'anonymised' };
  if (call.status !== 'completed' || (call.recording === null && call.transcript === null)) {
    return { outcome: 'skipped', reason: 'not_recorded' };
  }
  if (!coveredCall(copilotCoverage(job.entityId), call.callerConverter)) {
    return { outcome: 'skipped', reason: 'not_covered' };
  }

  const base = { eventId: job.eventId, kind: 'call_summary' as const, entityId: job.entityId };
  const config = await copilotSettings(job.entityId, 'call_summary');
  if (!copilotMayRun(config)) {
    const stopped = await recordCopilotStop(base, deps);
    return { outcome: 'stopped', runs: { qualification: stopped }, transcribed: false };
  }

  let transcript: string;
  let transcribed = false;
  if (call.transcript !== null) {
    transcript = new TextDecoder().decode(
      await storedBytes(deps.store, call.transcript.key, call.transcript.sha256),
    );
  } else {
    const recording = call.recording;
    if (recording === null) return { outcome: 'skipped', reason: 'not_recorded' };
    if (!WAV_TYPES.has(recording.contentType.toLowerCase())) {
      return { outcome: 'skipped', reason: 'not_wav' };
    }
    const speech = deps.transcriber;
    if (speech === undefined) return { outcome: 'skipped', reason: 'no_speech_service' };
    const bytes = await storedBytes(deps.store, recording.key, recording.sha256);
    let audioMs: number;
    try {
      audioMs = speech.durationMs(bytes, recording.contentType);
    } catch (error) {
      if (error instanceof KnowledgeExtractError)
        return { outcome: 'skipped', reason: 'unreadable' };
      throw error;
    }
    if (audioMs > AGENT_DEFAULTS.copilot.maxCallMinutes * 60_000) {
      return { outcome: 'skipped', reason: 'too_long' };
    }
    const paise = (ms: number): number => (ms / 3_600_000) * speech.paisePerHour;
    let heard: string;
    try {
      heard = await deps.provider.metered(
        {
          agent: 'agent:copilot',
          purpose: 'copilot_transcribe',
          entityId: job.entityId,
          caps: [...config.caps, ...copilotCeilings(job.entityId)],
          vendor: speech.vendor,
          maxPaise: paise(audioMs),
          totalTimeoutMs: AGENT_DEFAULTS.copilot.totalTimeoutMs,
        },
        (paid) =>
          speech.transcribe(bytes, {
            contentType: recording.contentType,
            signal: AbortSignal.timeout(AGENT_DEFAULTS.copilot.totalTimeoutMs),
            sent: (pieceMs) => {
              paid(paise(pieceMs));
            },
          }),
      );
    } catch (error) {
      if (error instanceof KnowledgeExtractError)
        return { outcome: 'skipped', reason: 'unreadable' };
      // The daily cap reached: the summary waits for no one; the run's stop is recorded.
      if (
        error instanceof DomainError &&
        error.code === 'rate_limited' &&
        error.details?.reason === 'agent_spend_cap_reached'
      ) {
        const stopped = await recordCopilotStop(base, deps);
        return { outcome: 'stopped', runs: { qualification: stopped }, transcribed: false };
      }
      throw error;
    }
    // The adapter answers Roman script only; a transcript that is not is never kept (ADR 0014).
    if (!isRomanScript(heard)) return { outcome: 'skipped', reason: 'unreadable' };
    const masked = maskWholeText(heard).trim();
    if (masked === '') return { outcome: 'skipped', reason: 'unreadable' };
    // A transcript over the limit keeps its end, where a call's agreements are.
    transcript =
      masked.length > CALL_TRANSCRIPT_MAX_CHARS
        ? masked.slice(masked.length - CALL_TRANSCRIPT_MAX_CHARS)
        : masked;
    const fileId = newId();
    const key = callTranscriptKey(job.entityId, fileId);
    const text = new TextEncoder().encode(transcript);
    await deps.store.put(key, text, 'text/plain');
    const attached = await executeCommand(
      deps.platform,
      { entityIds: [job.entityId] },
      attachCallTranscript,
      {
        entityId: job.entityId,
        providerCallId: job.providerCallId,
        fileId,
        bucket: deps.store.bucket,
        key,
        size: text.byteLength,
        sha256: sha256Hex(text),
      },
      { hosted: deps.hosted },
    );
    if (attached.outcome === 'not_recorded' || attached.outcome === 'missing') {
      return { outcome: 'skipped', reason: 'not_recorded' };
    }
    // Another delivery kept its transcript first: that one is the call's.
    if (attached.outcome === 'other_file') {
      const again = await readCallFacts(job, deps.platform);
      if (again?.transcript === null || again?.transcript === undefined) {
        return { outcome: 'skipped', reason: 'not_recorded' };
      }
      transcript = new TextDecoder().decode(
        await storedBytes(deps.store, again.transcript.key, again.transcript.sha256),
      );
    }
    transcribed = true;
  }

  const result = await runCopilot(
    {
      eventId: job.eventId,
      kind: 'call_summary',
      entityId: job.entityId,
      opportunityId: call.opportunityId,
      providerCallId: job.providerCallId,
      transcript,
    },
    deps,
  );
  return { ...result, transcribed };
}
