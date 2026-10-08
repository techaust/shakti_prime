import { z } from 'zod';

/**
 * `POST /webhooks/livekit` (docs/06-api.md §3.4): room and participant events for voice sessions,
 * shaped as LiveKit's webhook reference describes them. LiveKit signs each call with a JWT in
 * `Authorization`, made with the project's API secret and carrying the body's SHA-256 in its
 * `sha256` claim; the route checks both before storing the payload. The body is protobuf JSON,
 * so 64-bit numbers may arrive as strings; objects are loose because LiveKit adds fields.
 */

const Int64 = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);

export const LIVEKIT_EVENTS = [
  'room_started',
  'room_finished',
  'participant_joined',
  'participant_left',
  'participant_connection_aborted',
  'track_published',
  'track_unpublished',
  'egress_started',
  'egress_updated',
  'egress_ended',
  'ingress_started',
  'ingress_ended',
] as const;
export const LiveKitEventSchema = z.enum(LIVEKIT_EVENTS);

const Room = z.looseObject({
  sid: z.string().min(1),
  /** `voice_sessions.id`: the BOS names each room after its session. */
  name: z.string().min(1),
  creationTime: Int64.optional(),
  numParticipants: z.number().int().optional(),
  metadata: z.string().optional(),
});

const Participant = z.looseObject({
  sid: z.string().min(1),
  /** `user:<id>` for the person, `agent:<name>` for the voice worker. */
  identity: z.string().min(1),
  name: z.string().optional(),
  state: z.string().optional(),
  kind: z.string().optional(),
  joinedAt: Int64.optional(),
  metadata: z.string().optional(),
});

export const LiveKitWebhook = z.looseObject({
  event: LiveKitEventSchema,
  id: z.string().min(1),
  createdAt: Int64,
  room: Room.optional(),
  participant: Participant.optional(),
  track: z.looseObject({ sid: z.string(), type: z.string().optional() }).optional(),
  egressInfo: z.looseObject({ egressId: z.string(), status: z.string().optional() }).optional(),
});
export type LiveKitWebhook = z.infer<typeof LiveKitWebhook>;
