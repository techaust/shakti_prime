import {
  CALL_TRANSCRIPT_MAX_CHARS,
  callTranscriptKey,
  DomainError,
  isRomanScript,
  newId,
  type AttachCallTranscriptDto,
  type Principal,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { executeCommand, executeQuery } from '../../command/execute';
import {
  attachCallTranscript,
  reserveCallTranscript,
} from '../../commands/calls/call-transcript';
import { deleteCallRecording } from '../../commands/calls/provider-calls';
import type { RecordingTranscriber } from '../../knowledge/index-file';
import { KnowledgeExtractError } from '../../knowledge/extract';
import { maskWholeText } from '../../knowledge/passages';
import { sha256Hex, type FileStore } from '../../ports/file-store';
import { AGENT_DEFAULTS, type CopilotCoverage } from '../agent-defaults';
import {
  copilotMayRun,
  copilotOutOfTime,
  copilotRunCaps,
  copilotSettings,
  copilotSpendFits,
  recordCopilotStop,
  runCopilot,
  type CopilotDeps,
  type CopilotRunResult,
} from './run-copilot';
import { spokenDigitsAsFigures } from './spoken-digits';

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
  endedAt: Date | null;
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
  | 'no_speech_service'
  /** The transcription ran past the time it was given. */
  | 'timed_out';

export type SummariseResult =
  { outcome: 'skipped'; why: SummarySkip } | (CopilotRunResult & { transcribed: boolean });

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
        select opportunity_id, direction, status, ended_at, caller_converter, lead_anonymised,
               recording_key, recording_content_type, recording_sha256,
               transcript_key, transcript_sha256
          from app.copilot_call_facts(${job.entityId}::smallint, ${job.providerCallId}::uuid)`)) as unknown as {
        opportunity_id: string | null;
        direction: string;
        status: string;
        ended_at: Date | string | null;
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
        endedAt: row.ended_at === null ? null : new Date(row.ended_at),
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
    // The calls definers are granted to `app_user` alone.
    { name: 'agents.copilot.call_facts', pool: 'app_user' },
  );
}

/**
 * Removes a transcript that did not become the call's: its bytes from the store and its row
 * marked deleted (`calls.recording.delete`). A failure here is logged and left to the sweep of
 * abandoned uploads, which finds the row still pending.
 */
async function discardTranscript(
  deps: SummariseDeps,
  entityId: number,
  fileId: string,
  key: string,
): Promise<void> {
  try {
    await deps.store.delete(key);
    await executeCommand(
      deps.platform,
      { entityIds: [entityId] },
      deleteCallRecording,
      { entityId, fileId },
      { hosted: deps.hosted },
    );
  } catch (error) {
    deps.logger?.log('warn', 'agent.copilot_transcript_not_discarded', { entityId, fileId, error });
  }
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
 * or of an anonymised lead is skipped and nothing is recorded. With the Co-pilot switched off,
 * without a spending limit or with too little of the day's spend left for the run, one stopped run
 * is recorded and the recording is not downloaded or sent anywhere. The transcription is bounded
 * by what is left of the delivery's time (`deps.timeLeft`). A transcript a delivery already made is
 * read back, never paid for twice.
 */
export async function summariseCall(
  job: SummariseJob,
  deps: SummariseDeps,
): Promise<SummariseResult> {
  const call = await readCallFacts(job, deps.platform);
  if (call === undefined || call.opportunityId === null || call.direction !== 'outbound') {
    return { outcome: 'skipped', why: 'not_a_dial' };
  }
  if (call.leadAnonymised) return { outcome: 'skipped', why: 'anonymised' };
  if (!coveredCall(copilotCoverage(job.entityId), call.callerConverter)) {
    return { outcome: 'skipped', why: 'not_covered' };
  }
  if (call.status !== 'completed') return { outcome: 'skipped', why: 'not_recorded' };
  const recorded = call.recording !== null || call.transcript !== null;
  const base = { eventId: job.eventId, kind: 'call_summary' as const, entityId: job.entityId };
  const config = await copilotSettings(job.entityId, 'call_summary');
  if (!copilotMayRun(config)) {
    if (!recorded) return { outcome: 'skipped', why: 'not_recorded' };
    const stopped = await recordCopilotStop(base, deps);
    return { outcome: 'stopped', runs: { qualification: stopped }, transcribed: false };
  }
  if (!recorded) {
    if (deps.transcriber === undefined) return { outcome: 'skipped', why: 'no_speech_service' };
    // The status is recorded before the recording is copied in: a call that ended moments ago is
    // delivered again until its recording is there or the wait is over.
    const now = (deps.now ?? (() => new Date()))().getTime();
    const waitMs = AGENT_DEFAULTS.copilot.recordingWaitMinutes * 60_000;
    if (call.endedAt !== null && now - call.endedAt.getTime() < waitMs) {
      throw new DomainError('integration_unavailable', 'the call recording is not copied in yet', {
        reason: 'call_recording_pending',
      });
    }
    return { outcome: 'skipped', why: 'not_recorded' };
  }

  // Before anything is downloaded: the day's spend must have room for the transcription of the
  // longest call this run takes and the summary's model call.
  const d = AGENT_DEFAULTS.copilot;
  const speechPaise =
    call.transcript === null && deps.transcriber !== undefined
      ? (d.maxCallMinutes / 60) * deps.transcriber.paisePerHour
      : 0;
  if (!(await copilotSpendFits(deps.provider, 'call_summary', job.entityId, config, speechPaise))) {
    const stopped = await recordCopilotStop(base, deps, true);
    return { outcome: 'stopped', runs: { qualification: stopped }, transcribed: false };
  }
  const timeLeft = deps.timeLeft ?? (() => Number.POSITIVE_INFINITY);

  let transcript: string;
  let transcribed = false;
  if (call.transcript !== null) {
    transcript = new TextDecoder().decode(
      await storedBytes(deps.store, call.transcript.key, call.transcript.sha256),
    );
  } else {
    const recording = call.recording;
    if (recording === null) return { outcome: 'skipped', why: 'not_recorded' };
    if (!WAV_TYPES.has(recording.contentType.toLowerCase())) {
      return { outcome: 'skipped', why: 'not_wav' };
    }
    const speech = deps.transcriber;
    if (speech === undefined) return { outcome: 'skipped', why: 'no_speech_service' };
    // The transcription gets what is left of the delivery, less the time to store and record it.
    if (timeLeft() - d.storeMarginMs < d.minTranscribeMs) throw copilotOutOfTime('transcribe');
    const bytes = await storedBytes(deps.store, recording.key, recording.sha256);
    let audioMs: number;
    try {
      audioMs = speech.durationMs(bytes, recording.contentType);
    } catch (error) {
      if (error instanceof KnowledgeExtractError) return { outcome: 'skipped', why: 'unreadable' };
      throw error;
    }
    if (audioMs > AGENT_DEFAULTS.copilot.maxCallMinutes * 60_000) {
      return { outcome: 'skipped', why: 'too_long' };
    }
    const paise = (ms: number): number => (ms / 3_600_000) * speech.paisePerHour;
    const transcribeMs = Math.min(d.totalTimeoutMs, timeLeft() - d.storeMarginMs);
    if (transcribeMs < d.minTranscribeMs) throw copilotOutOfTime('transcribe');
    let heard: string;
    try {
      heard = await deps.provider.metered(
        {
          agent: 'agent:copilot',
          purpose: 'copilot_transcribe',
          entityId: job.entityId,
          caps: copilotRunCaps(config, job.entityId),
          vendor: speech.vendor,
          maxPaise: paise(audioMs),
          totalTimeoutMs: transcribeMs,
        },
        (paid) =>
          speech.transcribe(bytes, {
            contentType: recording.contentType,
            signal: AbortSignal.timeout(transcribeMs),
            sent: (pieceMs) => {
              paid(paise(pieceMs));
            },
          }),
      );
    } catch (error) {
      if (error instanceof KnowledgeExtractError) {
        return {
          outcome: 'skipped',
          why: error.reason === 'knowledge_timed_out' ? 'timed_out' : 'unreadable',
        };
      }
      // The daily cap reached: the summary waits for no one; the run's stop is recorded.
      if (
        error instanceof DomainError &&
        error.code === 'rate_limited' &&
        error.details?.reason === 'agent_spend_cap_reached'
      ) {
        const stopped = await recordCopilotStop(base, deps, true);
        return { outcome: 'stopped', runs: { qualification: stopped }, transcribed: false };
      }
      throw error;
    }
    // The adapter answers Roman script only; a transcript that is not is never kept (ADR 0014).
    if (!isRomanScript(heard)) return { outcome: 'skipped', why: 'unreadable' };
    // A number said digit by digit is written in figures first, so it is masked whole.
    const masked = maskWholeText(spokenDigitsAsFigures(heard)).trim();
    if (masked === '') return { outcome: 'skipped', why: 'unreadable' };
    // A transcript over the limit keeps its end, where a call's agreements are.
    transcript =
      masked.length > CALL_TRANSCRIPT_MAX_CHARS
        ? masked.slice(masked.length - CALL_TRANSCRIPT_MAX_CHARS)
        : masked;
    const fileId = newId();
    const key = callTranscriptKey(job.entityId, fileId);
    const text = new TextEncoder().encode(transcript);
    const file = {
      entityId: job.entityId,
      providerCallId: job.providerCallId,
      fileId,
      bucket: deps.store.bucket,
      key,
      size: text.byteLength,
      sha256: sha256Hex(text),
    };
    const scope = { entityIds: [job.entityId] };
    // The file's row first, `pending`, so bytes in the store always have one: a run that stops
    // before the attach leaves a pending row, which the sweep of abandoned uploads removes.
    const reserved = await executeCommand(deps.platform, scope, reserveCallTranscript, file, {
      hosted: deps.hosted,
    });
    let attached: AttachCallTranscriptDto | undefined;
    if (reserved.outcome === 'reserved') {
      await deps.store.put(key, text, 'text/plain');
      try {
        attached = await executeCommand(deps.platform, scope, attachCallTranscript, file, {
          hosted: deps.hosted,
        });
      } finally {
        // A transcript that is not the call's is removed at once, with its row.
        if (attached?.outcome !== 'attached' && attached?.outcome !== 'already') {
          await discardTranscript(deps, job.entityId, fileId, key);
        }
      }
    }
    const outcome = attached?.outcome ?? reserved.outcome;
    if (outcome === 'not_recorded' || outcome === 'missing') {
      return { outcome: 'skipped', why: 'not_recorded' };
    }
    // Another delivery kept its transcript first: that one is the call's.
    if (outcome === 'other_file') {
      const again = await readCallFacts(job, deps.platform);
      if (again?.transcript === null || again?.transcript === undefined) {
        return { outcome: 'skipped', why: 'not_recorded' };
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
