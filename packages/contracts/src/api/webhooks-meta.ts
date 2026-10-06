import { z } from 'zod';

/**
 * Meta webhooks (docs/06-api.md §3.4): WhatsApp Cloud API and Lead Ads. Shapes follow Meta's public
 * webhook reference. Meta adds fields without notice, so every provider object is loose (unknown
 * keys kept) and only the fields the workers act on are required. The route verifies
 * `X-Hub-Signature-256` over the raw body before anything is parsed, stores the raw payload in
 * `webhook_inbox`, answers 200, and a worker parses it with these schemas.
 */

/** `X-Hub-Signature-256: sha256=<hex HMAC of the raw body with the app secret>`. */
export const MetaSignatureHeaderSchema = z.string().regex(/^sha256=[0-9a-f]{64}$/);

/** Unix seconds as Meta sends them, in a string. */
const UnixSecondsString = z.string().regex(/^\d{9,11}$/);

/** A WhatsApp id: the customer's number in international form without the plus. */
const WaId = z.string().regex(/^[1-9]\d{6,14}$/);

/** `GET /webhooks/meta/whatsapp`: the subscription handshake; the route echoes `hub.challenge`. */
export const MetaVerifyQuery = z.looseObject({
  'hub.mode': z.literal('subscribe'),
  'hub.verify_token': z.string().min(1),
  'hub.challenge': z.string().min(1),
});
export type MetaVerifyQuery = z.infer<typeof MetaVerifyQuery>;

const Media = z.looseObject({
  id: z.string().min(1),
  mime_type: z.string().min(1),
  sha256: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
});

export const WHATSAPP_MESSAGE_TYPES = [
  'text',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'contacts',
  'button',
  'interactive',
  'reaction',
  'order',
  'system',
  'request_welcome',
  'unsupported',
  'unknown',
] as const;

/** One inbound message. The body is customer content: untrusted, masked before any model sees it. */
export const WhatsAppInboundMessage = z.looseObject({
  from: WaId,
  id: z.string().min(1),
  timestamp: UnixSecondsString,
  type: z.enum(WHATSAPP_MESSAGE_TYPES),
  text: z.looseObject({ body: z.string() }).optional(),
  image: Media.optional(),
  audio: Media.optional(),
  video: Media.optional(),
  document: Media.optional(),
  sticker: Media.optional(),
  location: z
    .looseObject({ latitude: z.number(), longitude: z.number(), name: z.string().optional() })
    .optional(),
  button: z.looseObject({ payload: z.string(), text: z.string() }).optional(),
  interactive: z
    .looseObject({
      type: z.enum(['button_reply', 'list_reply', 'nfm_reply']),
      button_reply: z.looseObject({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.looseObject({ id: z.string(), title: z.string() }).optional(),
    })
    .optional(),
  reaction: z.looseObject({ message_id: z.string(), emoji: z.string().optional() }).optional(),
  /** The message this one replies to. */
  context: z.looseObject({ from: z.string().optional(), id: z.string() }).optional(),
  /** Set when the chat started from a click-to-WhatsApp ad: the attribution source. */
  referral: z
    .looseObject({
      source_url: z.string().optional(),
      source_id: z.string().optional(),
      source_type: z.string().optional(),
      ctwa_clid: z.string().optional(),
    })
    .optional(),
});
export type WhatsAppInboundMessage = z.infer<typeof WhatsAppInboundMessage>;

const MetaError = z.looseObject({
  code: z.number().int(),
  title: z.string().optional(),
  message: z.string().optional(),
});

/** Delivery status of a message the BOS sent; it updates `whatsapp_messages.status`. */
export const WhatsAppStatus = z.looseObject({
  id: z.string().min(1),
  status: z.enum(['sent', 'delivered', 'read', 'failed', 'deleted']),
  timestamp: UnixSecondsString,
  recipient_id: WaId,
  conversation: z
    .looseObject({
      id: z.string(),
      expiration_timestamp: UnixSecondsString.optional(),
      origin: z.looseObject({ type: z.string() }).optional(),
    })
    .optional(),
  pricing: z
    .looseObject({
      billable: z.boolean().optional(),
      pricing_model: z.string().optional(),
      category: z.string().optional(),
    })
    .optional(),
  errors: z.array(MetaError).optional(),
});
export type WhatsAppStatus = z.infer<typeof WhatsAppStatus>;

const MessagesChange = z.looseObject({
  field: z.literal('messages'),
  value: z.looseObject({
    messaging_product: z.literal('whatsapp'),
    metadata: z.looseObject({
      display_phone_number: z.string().min(1),
      /** Names the entity's number (`entity_channels.provider_ref`). */
      phone_number_id: z.string().min(1),
    }),
    contacts: z
      .array(
        z.looseObject({
          wa_id: WaId,
          profile: z.looseObject({ name: z.string() }).optional(),
        }),
      )
      .optional(),
    messages: z.array(WhatsAppInboundMessage).optional(),
    statuses: z.array(WhatsAppStatus).optional(),
    errors: z.array(MetaError).optional(),
  }),
});

const TemplateStatusChange = z.looseObject({
  field: z.literal('message_template_status_update'),
  value: z.looseObject({
    event: z.string().min(1),
    message_template_id: z.number().int(),
    message_template_name: z.string().min(1),
    message_template_language: z.string().min(2),
    reason: z.string().nullable().optional(),
  }),
});

const QualityChange = z.looseObject({
  field: z.literal('phone_number_quality_update'),
  value: z.looseObject({
    display_phone_number: z.string().min(1),
    event: z.string().min(1),
    current_limit: z.string().optional(),
  }),
});

const HANDLED_FIELDS = [
  'messages',
  'message_template_status_update',
  'phone_number_quality_update',
] as const;

/** A change for a field the BOS does not handle is stored and acknowledged, never an error. */
const OtherChange = z.looseObject({
  field: z
    .string()
    .refine((f) => !(HANDLED_FIELDS as readonly string[]).includes(f), 'a handled field'),
  value: z.unknown(),
});

export const WhatsAppChange = z.union([
  MessagesChange,
  TemplateStatusChange,
  QualityChange,
  OtherChange,
]);

/** `POST /webhooks/meta/whatsapp`. */
export const WhatsAppWebhook = z.looseObject({
  object: z.literal('whatsapp_business_account'),
  entry: z
    .array(
      z.looseObject({
        /** The WhatsApp Business Account id. */
        id: z.string().min(1),
        changes: z.array(WhatsAppChange).min(1),
      }),
    )
    .min(1),
});
export type WhatsAppWebhook = z.infer<typeof WhatsAppWebhook>;

/**
 * `POST /webhooks/meta/leadgen`: only ids arrive. The worker fetches the lead from the Graph API
 * with the page token (`MetaLeadDetails`) and normalises it.
 */
export const MetaLeadgenWebhook = z.looseObject({
  object: z.literal('page'),
  entry: z
    .array(
      z.looseObject({
        id: z.string().min(1),
        time: z.number().int(),
        changes: z
          .array(
            z.looseObject({
              field: z.literal('leadgen'),
              value: z.looseObject({
                leadgen_id: z.string().min(1),
                form_id: z.string().min(1),
                page_id: z.string().min(1),
                created_time: z.number().int(),
                ad_id: z.string().optional(),
                adgroup_id: z.string().optional(),
              }),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});
export type MetaLeadgenWebhook = z.infer<typeof MetaLeadgenWebhook>;

/** The lead as the Graph API returns it for `GET /<leadgen_id>`. */
export const MetaLeadDetails = z.looseObject({
  id: z.string().min(1),
  created_time: z.string().min(1),
  form_id: z.string().optional(),
  ad_id: z.string().optional(),
  campaign_id: z.string().optional(),
  is_organic: z.boolean().optional(),
  field_data: z
    .array(z.looseObject({ name: z.string().min(1), values: z.array(z.string()) }))
    .min(1),
});
export type MetaLeadDetails = z.infer<typeof MetaLeadDetails>;
