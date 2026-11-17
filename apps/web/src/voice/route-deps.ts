import {
  addKnowledgeFile,
  executeCommand,
  executeQuery,
  liveVoiceSessionFacts,
  recordVoiceSession,
  refreshVoiceToken,
  startVoiceSession,
  voiceRecordingUpload,
} from '@shakti/domain';
import { commandOptions } from '../actions/support';
import { currentPrincipal } from '../auth/current-principal';
import { defaultAuthDeps } from '../auth/deps';
import { voicePrincipalFromToken } from '../auth/voice-principal';
import { completeUploadFor, presignUpload } from '../files/uploads';
import { systemWorkersPrincipal } from '../workers/events/system-principal';
import type { SessionRouteDeps, TokenRouteDeps } from './handlers';
import type { RecordingRouteDeps } from './recording';

/**
 * The voice routes' real dependencies: the session or the voice token, the shared store that
 * counts calls, and the two commands, each run in the caller's own companies.
 */
export function sessionRouteDeps(): SessionRouteDeps {
  return {
    principal: currentPrincipal,
    keyValue: defaultAuthDeps().keyValue,
    endUnopened: async (sessionId, endedAt, requestId) => {
      await executeCommand(
        systemWorkersPrincipal(null),
        { entityIds: [], requestId },
        recordVoiceSession,
        { sessionId, endedAt: endedAt.toISOString() },
      );
    },
    start: (principal, input, meta) =>
      executeCommand(
        principal,
        { entityIds: principal.entityIds, requestId: meta.requestId },
        startVoiceSession,
        input,
        commandOptions(meta),
      ),
  };
}

export function tokenRouteDeps(): TokenRouteDeps {
  return {
    voicePrincipal: (token) => voicePrincipalFromToken(token),
    keyValue: defaultAuthDeps().keyValue,
    refresh: (principal, meta) =>
      executeCommand(
        principal,
        { entityIds: principal.entityIds, requestId: meta.requestId },
        refreshVoiceToken,
        {},
        commandOptions(meta),
      ),
  };
}

/**
 * The recording routes' real dependencies: the voice token, the session read as its person, the
 * usual upload flow and K3's vault filing as the voice principal, and the platform's link.
 */
export function recordingRouteDeps(): RecordingRouteDeps {
  return {
    voicePrincipal: (token) => voicePrincipalFromToken(token),
    session: (principal, requestId) =>
      executeQuery(
        principal,
        { entityIds: principal.entityIds, requestId },
        (context) => liveVoiceSessionFacts(context, new Date()),
        { name: 'liveVoiceSessionFacts' },
      ),
    begun: (principal, requestId) =>
      executeQuery(
        principal,
        { entityIds: principal.entityIds, requestId },
        (context) => voiceRecordingUpload(context),
        { name: 'voiceRecordingUpload' },
      ),
    presign: (principal, input, call) => presignUpload(principal, input, call),
    complete: (principal, fileId, call) => completeUploadFor(principal, fileId, 'knowledge', call),
    file: (principal, input, call) =>
      executeCommand(
        principal,
        { entityIds: [input.entityId], requestId: call.requestId },
        addKnowledgeFile,
        { ...input, sensitivity: 'exec_only' },
        call.options,
      ),
    link: async (sessionId, fileId, requestId) => {
      const recorded = await executeCommand(
        systemWorkersPrincipal(null),
        { entityIds: [], requestId },
        recordVoiceSession,
        { sessionId, audioFileId: fileId },
      );
      return recorded.filesLinked && recorded.outcome !== 'missing';
    },
    options: commandOptions,
    keyValue: defaultAuthDeps().keyValue,
  };
}
