import {
  hasGrant,
  isDomainError,
  VoiceRecordingCompleteRequest,
  VoiceRecordingCompleteResponse,
  VoiceRecordingRequest,
  type ErrorCode,
  type FilePresignRequest,
  type FilePresignResponse,
  type Principal,
} from '@shakti/contracts';
import type { ClientMeta, KeyValue, VoiceSessionFacts } from '@shakti/domain';
import en from '../../messages/en.json';
import { apiFailure } from '../api-failure';
import { clientMeta } from '../auth/client-address';
import { countRequest, type CapRule } from '../auth/request-cap';
import type { UploadCall } from '../files/uploads';
import { logger } from '../log';
import { declaredTooLarge, readTextWithin } from '../request-body';
import { incomingRequestId } from '../request-id';
import { formatDate } from '../screens/format';

// A recorded Teach session's audio (docs/03-roadmap-appendix/phase2.md §7.5, K3): the voice worker
// uploads the person's speech as a WAV straight to the file store through the usual upload flow
// (never the request body), then the BOS files it in the Knowledge Vault as the person, Executive
// only, and links it to the session. K3's index job transcribes it, masks the transcript and keeps
// it as the vault file's own text, so no transcript travels separately. Only for a live Teach
// session of the token's person who answered yes to the recording question, once per session.

/** Either body is two short fields. */
const BODY_MAX_BYTES = 512;

/** Calls one session may make in five minutes: a retry or two of each step. */
export const VOICE_RECORDING_CAP: CapRule = { window: 5 * 60, max: 6 };

const ANSWERED: readonly ErrorCode[] = [
  'validation_failed',
  'forbidden',
  'not_found',
  'conflict',
  'integration_unavailable',
];

export interface RecordingRouteDeps {
  /** The voice principal a token speaks for, while its session is live; undefined otherwise. */
  voicePrincipal: (token: string) => Promise<{ principal: Principal } | undefined>;
  /** The voice principal's live session, read as its person. */
  session: (principal: Principal, requestId: string) => Promise<VoiceSessionFacts | undefined>;
  /** The file of the upload begun for the session (`voiceRecordingUpload`), if any. */
  begun: (principal: Principal, requestId: string) => Promise<string | undefined>;
  presign: (
    principal: Principal,
    input: FilePresignRequest,
    call: UploadCall,
  ) => Promise<FilePresignResponse>;
  complete: (principal: Principal, fileId: string, call: UploadCall) => Promise<unknown>;
  /** `knowledge.file.add` as the voice principal: the audio as an Executive-only vault file. */
  file: (
    principal: Principal,
    input: { entityId: number; fileId: string; title: string },
    call: UploadCall,
  ) => Promise<{ id: string }>;
  /** `voice.session.record` for the platform: links the audio to the session. */
  link: (sessionId: string, fileId: string, requestId: string) => Promise<boolean>;
  options: (meta: { client: ClientMeta }, idempotencyKey?: string) => UploadCall['options'];
  keyValue: KeyValue;
  now?: () => Date;
}

/** The token after `Bearer `, of the characters a JWT uses; undefined for anything else. */
function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  return header === null ? undefined : /^Bearer ([\w.~+/=-]{1,4096})$/.exec(header)?.[1];
}

type Prepared =
  | { ok: true; principal: Principal; session: VoiceSessionFacts; body: unknown; requestId: string }
  | { ok: false; response: Response };

/**
 * What both steps check first: the voice token of a live session, the session's own cap, a Teach
 * session with the person's yes to the recording question, a person who may file an Executive-only
 * vault file, and a small JSON body.
 */
async function prepare(request: Request, deps: RecordingRouteDeps): Promise<Prepared> {
  const requestId = incomingRequestId(request.headers);
  const fail = (code: ErrorCode, reason?: string, headers?: Record<string, string>) => ({
    ok: false as const,
    response: apiFailure(code, requestId, reason === undefined ? undefined : { reason }, headers),
  });
  const token = bearerToken(request);
  if (token === undefined) return fail('unauthorized');
  if (declaredTooLarge(request.headers, BODY_MAX_BYTES)) return fail('validation_failed');
  let principal: Principal | undefined;
  let session: VoiceSessionFacts | undefined;
  try {
    principal = (await deps.voicePrincipal(token))?.principal;
    if (principal === undefined) return fail('unauthorized');
    session = await deps.session(principal, requestId);
  } catch (error) {
    logger.log('error', 'voice.recording_principal_failed', { requestId, error });
    return fail('internal');
  }
  if (session === undefined) return fail('forbidden', 'voice_session_ended');
  if (
    session.mode !== 'teach' ||
    !session.consentRecording ||
    !hasGrant(principal.permissions, 'knowledge.vault.write', 'all') ||
    !hasGrant(principal.permissions, 'knowledge.vault.read.exec', 'all')
  ) {
    return fail('forbidden', 'voice_recording_refused');
  }
  try {
    const counted = await countRequest(
      deps.keyValue,
      `voice-recording:${principal.voiceSessionId ?? principal.id}`,
      VOICE_RECORDING_CAP,
    );
    if (!counted.allowed) {
      return fail('rate_limited', undefined, { 'retry-after': String(counted.retryAfter) });
    }
  } catch (error) {
    logger.log('error', 'voice.recording_cap_failed', { requestId, error });
    return fail('integration_unavailable');
  }
  const text = await readTextWithin(request, BODY_MAX_BYTES).catch(() => undefined);
  if (text === undefined) return fail('validation_failed');
  try {
    return { ok: true, principal, session, body: JSON.parse(text) as unknown, requestId };
  } catch {
    return fail('validation_failed');
  }
}

function refused(error: unknown, requestId: string, event: string): Response {
  if (isDomainError(error) && ANSWERED.includes(error.code)) {
    const reason = error.details?.reason;
    return apiFailure(error.code, requestId, typeof reason === 'string' ? { reason } : undefined);
  }
  logger.log('error', event, { requestId, error });
  return apiFailure('internal', requestId);
}

const ok = (body: unknown, requestId: string): Response =>
  Response.json(body, { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });

/** The vault company of a session: its one company, or the first of those it covers. */
function vaultCompany(session: VoiceSessionFacts): number {
  return session.entityId ?? Math.min(...session.entityIds);
}

/** `POST /api/v1/voice/recording`: the upload address of the session's recording, once. */
export async function voiceRecordingRoute(
  request: Request,
  deps: RecordingRouteDeps,
): Promise<Response> {
  const prepared = await prepare(request, deps);
  if (!prepared.ok) return prepared.response;
  const { principal, session, requestId } = prepared;
  if (session.audioFileId !== null)
    return apiFailure('conflict', requestId, { reason: 'voice_recording_refused' });
  const input = VoiceRecordingRequest.safeParse(prepared.body);
  if (!input.success) return apiFailure('validation_failed', requestId);
  const day = formatDate((deps.now ?? (() => new Date()))());
  // The session's own id is the upload's key, so a second ask for the same recording gets the
  // same file, and one for other bytes is refused (`idempotency_mismatch`): one per session.
  const call: UploadCall = {
    requestId,
    options: deps.options({ client: clientMeta(request.headers) }, principal.voiceSessionId),
  };
  try {
    const slot = await deps.presign(
      principal,
      {
        entityId: vaultCompany(session),
        purpose: 'knowledge',
        name: en.voice.recording.fileName.replace('{date}', day),
        contentType: 'audio/wav',
        size: input.data.size,
        sha256: input.data.sha256,
      },
      call,
    );
    return ok(slot, requestId);
  } catch (error) {
    return refused(error, requestId, 'voice.recording_presign_failed');
  }
}

/** `POST /api/v1/voice/recording/complete`: the recording landed; filed and linked. */
export async function voiceRecordingCompleteRoute(
  request: Request,
  deps: RecordingRouteDeps,
): Promise<Response> {
  const prepared = await prepare(request, deps);
  if (!prepared.ok) return prepared.response;
  const { principal, session, requestId } = prepared;
  const input = VoiceRecordingCompleteRequest.safeParse(prepared.body);
  if (!input.success) return apiFailure('validation_failed', requestId);
  if (session.audioFileId !== null) {
    return apiFailure('conflict', requestId, { reason: 'voice_recording_refused' });
  }
  // Only the file of the upload begun for this session, never another of the person's uploads.
  let begun: string | undefined;
  try {
    begun = await deps.begun(principal, requestId);
  } catch (error) {
    return refused(error, requestId, 'voice.recording_begun_failed');
  }
  if (begun !== input.data.fileId) {
    return apiFailure('forbidden', requestId, { reason: 'voice_recording_refused' });
  }
  const call: UploadCall = {
    requestId,
    options: deps.options({ client: clientMeta(request.headers) }),
  };
  const sessionId = principal.voiceSessionId ?? '';
  try {
    await deps.complete(principal, input.data.fileId, call);
    const day = formatDate((deps.now ?? (() => new Date()))());
    const filed = await deps.file(
      principal,
      {
        entityId: vaultCompany(session),
        fileId: input.data.fileId,
        title: en.voice.recording.title.replace('{date}', day),
      },
      call,
    );
    const linked = await deps.link(sessionId, input.data.fileId, requestId);
    return ok(
      VoiceRecordingCompleteResponse.parse({
        fileId: input.data.fileId,
        knowledgeFileId: filed.id,
        linked,
      }),
      requestId,
    );
  } catch (error) {
    return refused(error, requestId, 'voice.recording_complete_failed');
  }
}
