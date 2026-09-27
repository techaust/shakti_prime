import type { z } from 'zod';
import type { ErrorCode } from '../errors';
import {
  IntegrationHealthQuery,
  IntegrationHealthResponse,
  IntegrationReplayRequest,
  IntegrationReplayResponse,
} from './admin-integrations';
import { CheckInRequest, CheckInResponse } from './attendance';
import { WebhookAck } from './common';
import {
  ConnectorBatchRequest,
  ConnectorBatchResponse,
  ConnectorCursorQuery,
  ConnectorCursorResponse,
  ConnectorHeartbeatRequest,
  ConnectorHeartbeatResponse,
  ConnectorReleaseResponse,
  ConnectorSnapshotRequest,
  ConnectorSnapshotResponse,
} from './connector';
import { CreateExpenseRequest, CreateExpenseResponse } from './expenses';
import {
  FileCompleteParams,
  FileCompleteRequest,
  FileCompleteResponse,
  FilePresignRequest,
  FilePresignResponse,
} from './files';
import { HealthResponse, ReadyResponse } from './health';
import { IngestHealthResponse, IngestLeadRequest, IngestLeadResponse } from './ingest';
import { MeResponse } from './me';
import {
  MobileRefreshRequest,
  MobileRefreshResponse,
  MobileRevokeRequest,
  MobileRevokeResponse,
  MobileTokenRequest,
  MobileTokenResponse,
} from './mobile-auth';
import { RealtimeTokenRequest, RealtimeTokenResponse } from './realtime';
import { SyncPullQuery, SyncPullResponse, SyncPushRequest, SyncPushResponse } from './sync';
import { VoiceSessionRequest, VoiceSessionResponse } from './voice';
import { ExotelCallStatusWebhook, ExotelIncomingWebhook } from './webhooks-exotel';
import { GoogleLeadFormWebhook } from './webhooks-google';
import { LiveKitWebhook } from './webhooks-livekit';
import { MetaLeadgenWebhook, MetaVerifyQuery, WhatsAppWebhook } from './webhooks-meta';
import {
  AgentRunJob,
  AgentRunParams,
  AgentRunResult,
  EmbeddingsIndexJob,
  EmbeddingsIndexResult,
  FileMaskJob,
  FileMaskResult,
  FileScanJob,
  FileScanResult,
  MessagingSendJob,
  MessagingSendResult,
  NotifyJob,
  NotifyResult,
  OutboxEventDelivery,
  OutboxEventParams,
  OutboxEventResult,
  PdfRenderJob,
  PdfRenderResult,
  SttTranscribeJob,
  SttTranscribeResult,
} from './worker-jobs';
import {
  ImportCommitWorkerBody,
  ImportCommitWorkerResponse,
  OutboxPublishResponse,
} from './workers';

/** How a caller proves who it is (docs/API.md §2). */
export type ApiAuth =
  | 'none'
  | 'credentials'
  | 'refresh_token'
  | 'bearer'
  | 'session_or_bearer'
  | 'session'
  | 'ingest_key'
  | 'provider_signature'
  | 'connector_hmac'
  | 'qstash_signature';

export interface ApiEndpoint {
  method: 'GET' | 'POST';
  /** Path under `/api/v1`, with `:param` placeholders. */
  path: string;
  auth: ApiAuth;
  /** A mutating call from the field app or the connector sends `Idempotency-Key`. */
  idempotencyKey: boolean;
  params?: z.ZodType;
  query?: z.ZodType;
  request?: z.ZodType;
  /** `text` for a plain-text answer (the WhatsApp handshake echoes the challenge). */
  response: z.ZodType | 'text';
  /** Codes of the error envelope this route can answer with, besides `internal`. */
  errors: readonly ErrorCode[];
}

const AUTHED: readonly ErrorCode[] = ['unauthorized', 'forbidden', 'rate_limited'];

/**
 * A worker answers `unauthorized` for a bad QStash signature, `validation_failed` for a body that
 * does not parse (not retried), and `integration_unavailable` for a failure QStash retries.
 */
const WORKER_ERRORS: readonly ErrorCode[] = [
  'validation_failed',
  'unauthorized',
  'integration_unavailable',
];

/**
 * Every `/api/v1` route with its contract (docs/API.md §3). A route handler parses with these
 * schemas and nothing else; the contract tests hold a recorded example for each entry.
 */
export const API_ENDPOINTS = {
  'auth.mobile.token': {
    method: 'POST',
    path: '/auth/mobile/token',
    auth: 'credentials',
    idempotencyKey: false,
    request: MobileTokenRequest,
    response: MobileTokenResponse,
    errors: ['validation_failed', 'unauthorized', 'forbidden', 'rate_limited'],
  },
  'auth.mobile.refresh': {
    method: 'POST',
    path: '/auth/mobile/refresh',
    auth: 'refresh_token',
    idempotencyKey: false,
    request: MobileRefreshRequest,
    response: MobileRefreshResponse,
    errors: ['validation_failed', 'unauthorized', 'forbidden', 'rate_limited'],
  },
  'auth.mobile.revoke': {
    method: 'POST',
    path: '/auth/mobile/revoke',
    auth: 'bearer',
    idempotencyKey: false,
    request: MobileRevokeRequest,
    response: MobileRevokeResponse,
    errors: ['unauthorized', 'rate_limited'],
  },
  me: {
    method: 'GET',
    path: '/me',
    auth: 'bearer',
    idempotencyKey: false,
    response: MeResponse,
    errors: ['unauthorized', 'rate_limited'],
  },
  'realtime.token': {
    method: 'POST',
    path: '/realtime/token',
    auth: 'session_or_bearer',
    idempotencyKey: false,
    request: RealtimeTokenRequest,
    response: RealtimeTokenResponse,
    errors: AUTHED,
  },
  'voice.session': {
    method: 'POST',
    path: '/voice/session',
    auth: 'session',
    idempotencyKey: false,
    request: VoiceSessionRequest,
    response: VoiceSessionResponse,
    errors: ['validation_failed', ...AUTHED, 'integration_unavailable'],
  },
  'sync.pull': {
    method: 'GET',
    path: '/sync/pull',
    auth: 'bearer',
    idempotencyKey: false,
    query: SyncPullQuery,
    response: SyncPullResponse,
    errors: ['validation_failed', ...AUTHED],
  },
  'sync.push': {
    method: 'POST',
    path: '/sync/push',
    auth: 'bearer',
    idempotencyKey: true,
    request: SyncPushRequest,
    response: SyncPushResponse,
    errors: ['validation_failed', ...AUTHED, 'conflict'],
  },
  'files.presign': {
    method: 'POST',
    path: '/files/presign',
    auth: 'bearer',
    idempotencyKey: true,
    request: FilePresignRequest,
    response: FilePresignResponse,
    errors: ['validation_failed', ...AUTHED, 'conflict', 'integration_unavailable'],
  },
  'files.complete': {
    method: 'POST',
    path: '/files/:id/complete',
    auth: 'bearer',
    idempotencyKey: true,
    params: FileCompleteParams,
    request: FileCompleteRequest,
    response: FileCompleteResponse,
    errors: ['validation_failed', ...AUTHED, 'not_found', 'conflict'],
  },
  'attendance.checkIn': {
    method: 'POST',
    path: '/attendance/check-in',
    auth: 'bearer',
    idempotencyKey: true,
    request: CheckInRequest,
    response: CheckInResponse,
    errors: ['validation_failed', ...AUTHED, 'not_found', 'conflict'],
  },
  'expenses.create': {
    method: 'POST',
    path: '/expenses',
    auth: 'bearer',
    idempotencyKey: true,
    request: CreateExpenseRequest,
    response: CreateExpenseResponse,
    errors: ['validation_failed', ...AUTHED, 'not_found', 'conflict'],
  },
  'ingest.leads': {
    method: 'POST',
    path: '/ingest/leads',
    auth: 'ingest_key',
    idempotencyKey: false,
    request: IngestLeadRequest,
    response: IngestLeadResponse,
    errors: ['validation_failed', 'unauthorized', 'forbidden', 'rate_limited'],
  },
  'ingest.health': {
    method: 'GET',
    path: '/ingest/health',
    auth: 'ingest_key',
    idempotencyKey: false,
    response: IngestHealthResponse,
    errors: ['unauthorized', 'rate_limited'],
  },
  'webhooks.whatsapp.verify': {
    method: 'GET',
    path: '/webhooks/meta/whatsapp',
    auth: 'provider_signature',
    idempotencyKey: false,
    query: MetaVerifyQuery,
    response: 'text',
    errors: ['forbidden'],
  },
  'webhooks.whatsapp': {
    method: 'POST',
    path: '/webhooks/meta/whatsapp',
    auth: 'provider_signature',
    idempotencyKey: false,
    request: WhatsAppWebhook,
    response: WebhookAck,
    errors: ['unauthorized'],
  },
  'webhooks.leadgen': {
    method: 'POST',
    path: '/webhooks/meta/leadgen',
    auth: 'provider_signature',
    idempotencyKey: false,
    request: MetaLeadgenWebhook,
    response: WebhookAck,
    errors: ['unauthorized'],
  },
  'webhooks.google': {
    method: 'POST',
    path: '/webhooks/google/leadform',
    auth: 'provider_signature',
    idempotencyKey: false,
    request: GoogleLeadFormWebhook,
    response: WebhookAck,
    errors: ['unauthorized'],
  },
  'webhooks.exotel.status': {
    method: 'POST',
    path: '/webhooks/exotel/call-status',
    auth: 'provider_signature',
    idempotencyKey: false,
    request: ExotelCallStatusWebhook,
    response: WebhookAck,
    errors: ['unauthorized'],
  },
  'webhooks.exotel.incoming': {
    method: 'POST',
    path: '/webhooks/exotel/incoming',
    auth: 'provider_signature',
    idempotencyKey: false,
    request: ExotelIncomingWebhook,
    response: WebhookAck,
    errors: ['unauthorized'],
  },
  'webhooks.livekit': {
    method: 'POST',
    path: '/webhooks/livekit',
    auth: 'provider_signature',
    idempotencyKey: false,
    request: LiveKitWebhook,
    response: WebhookAck,
    errors: ['unauthorized'],
  },
  'connector.heartbeat': {
    method: 'POST',
    path: '/connector/tally/heartbeat',
    auth: 'connector_hmac',
    idempotencyKey: false,
    request: ConnectorHeartbeatRequest,
    response: ConnectorHeartbeatResponse,
    errors: ['validation_failed', 'unauthorized', 'rate_limited'],
  },
  'connector.batches': {
    method: 'POST',
    path: '/connector/tally/batches',
    auth: 'connector_hmac',
    idempotencyKey: true,
    request: ConnectorBatchRequest,
    response: ConnectorBatchResponse,
    errors: ['validation_failed', 'unauthorized', 'forbidden', 'conflict', 'rate_limited'],
  },
  'connector.snapshot': {
    method: 'POST',
    path: '/connector/tally/snapshot',
    auth: 'connector_hmac',
    idempotencyKey: true,
    request: ConnectorSnapshotRequest,
    response: ConnectorSnapshotResponse,
    errors: ['validation_failed', 'unauthorized', 'forbidden', 'conflict', 'rate_limited'],
  },
  'connector.cursor': {
    method: 'GET',
    path: '/connector/tally/cursor',
    auth: 'connector_hmac',
    idempotencyKey: false,
    query: ConnectorCursorQuery,
    response: ConnectorCursorResponse,
    errors: ['validation_failed', 'unauthorized', 'forbidden', 'rate_limited'],
  },
  'connector.release': {
    method: 'GET',
    path: '/connector/release',
    auth: 'connector_hmac',
    idempotencyKey: false,
    response: ConnectorReleaseResponse,
    errors: ['unauthorized', 'rate_limited'],
  },
  'workers.outbox.publish': {
    method: 'POST',
    path: '/workers/outbox/publish',
    auth: 'qstash_signature',
    idempotencyKey: false,
    response: OutboxPublishResponse,
    errors: ['unauthorized', 'integration_unavailable'],
  },
  'workers.imports.commit': {
    method: 'POST',
    path: '/workers/imports/commit',
    auth: 'qstash_signature',
    idempotencyKey: false,
    request: ImportCommitWorkerBody,
    response: ImportCommitWorkerResponse,
    errors: ['unauthorized', 'forbidden', 'integration_unavailable'],
  },
  'workers.outbox.event': {
    method: 'POST',
    path: '/workers/outbox/:type',
    auth: 'qstash_signature',
    idempotencyKey: false,
    params: OutboxEventParams,
    request: OutboxEventDelivery,
    response: OutboxEventResult,
    errors: WORKER_ERRORS,
  },
  'workers.messaging.send': {
    method: 'POST',
    path: '/workers/messaging/send',
    auth: 'qstash_signature',
    idempotencyKey: false,
    request: MessagingSendJob,
    response: MessagingSendResult,
    errors: WORKER_ERRORS,
  },
  'workers.files.scan': {
    method: 'POST',
    path: '/workers/files/scan',
    auth: 'qstash_signature',
    idempotencyKey: false,
    request: FileScanJob,
    response: FileScanResult,
    errors: WORKER_ERRORS,
  },
  'workers.files.mask': {
    method: 'POST',
    path: '/workers/files/mask',
    auth: 'qstash_signature',
    idempotencyKey: false,
    request: FileMaskJob,
    response: FileMaskResult,
    errors: WORKER_ERRORS,
  },
  'workers.pdf.render': {
    method: 'POST',
    path: '/workers/pdf/render',
    auth: 'qstash_signature',
    idempotencyKey: false,
    request: PdfRenderJob,
    response: PdfRenderResult,
    errors: WORKER_ERRORS,
  },
  'workers.agents.run': {
    method: 'POST',
    path: '/workers/agents/:agent',
    auth: 'qstash_signature',
    idempotencyKey: false,
    params: AgentRunParams,
    request: AgentRunJob,
    response: AgentRunResult,
    errors: WORKER_ERRORS,
  },
  'workers.stt.transcribe': {
    method: 'POST',
    path: '/workers/stt/transcribe',
    auth: 'qstash_signature',
    idempotencyKey: false,
    request: SttTranscribeJob,
    response: SttTranscribeResult,
    errors: WORKER_ERRORS,
  },
  'workers.embeddings.index': {
    method: 'POST',
    path: '/workers/embeddings/index',
    auth: 'qstash_signature',
    idempotencyKey: false,
    request: EmbeddingsIndexJob,
    response: EmbeddingsIndexResult,
    errors: WORKER_ERRORS,
  },
  'workers.notify': {
    method: 'POST',
    path: '/workers/notify',
    auth: 'qstash_signature',
    idempotencyKey: false,
    request: NotifyJob,
    response: NotifyResult,
    errors: WORKER_ERRORS,
  },
  'admin.integrations': {
    method: 'GET',
    path: '/admin/integrations',
    auth: 'session',
    idempotencyKey: false,
    query: IntegrationHealthQuery,
    response: IntegrationHealthResponse,
    errors: ['validation_failed', ...AUTHED],
  },
  'admin.integrations.replay': {
    method: 'POST',
    path: '/admin/integrations/replay',
    auth: 'session',
    idempotencyKey: false,
    request: IntegrationReplayRequest,
    response: IntegrationReplayResponse,
    errors: ['validation_failed', ...AUTHED, 'not_found', 'conflict'],
  },
  health: {
    method: 'GET',
    path: '/health',
    auth: 'none',
    idempotencyKey: false,
    response: HealthResponse,
    errors: [],
  },
  'health.ready': {
    method: 'GET',
    path: '/health/ready',
    auth: 'none',
    idempotencyKey: false,
    response: ReadyResponse,
    errors: [],
  },
} as const satisfies Record<string, ApiEndpoint>;

export type ApiEndpointId = keyof typeof API_ENDPOINTS;
