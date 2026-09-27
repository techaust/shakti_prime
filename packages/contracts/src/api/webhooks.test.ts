import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { API_FIXTURES } from './fixtures';
import { ExotelCallStatusWebhook, ExotelIncomingWebhook } from './webhooks-exotel';
import { GoogleLeadFormWebhook } from './webhooks-google';
import { LiveKitWebhook } from './webhooks-livekit';
import { MetaSignatureHeaderSchema, WhatsAppWebhook } from './webhooks-meta';

type Json = Record<string, unknown>;
const whatsapp = API_FIXTURES['webhooks.whatsapp'].request as {
  entry: [{ id: string; changes: Json[] }];
} & Json;

function withChanges(changes: Json[]): unknown {
  return { ...whatsapp, entry: [{ ...whatsapp.entry[0], changes }] };
}

describe('Meta webhooks', () => {
  it('reads the signature header Meta sends', () => {
    const body = JSON.stringify(whatsapp);
    const hex = createHmac('sha256', 'meta app secret for the contract test')
      .update(body)
      .digest('hex');
    expect(MetaSignatureHeaderSchema.safeParse(`sha256=${hex}`).success).toBe(true);
    expect(MetaSignatureHeaderSchema.safeParse(hex).success).toBe(false);
  });

  it('keeps fields Meta adds later', () => {
    const parsed = WhatsAppWebhook.parse({ ...whatsapp, added_by_meta: 1 }) as Json;
    expect(parsed.added_by_meta).toBe(1);
  });

  it('acknowledges a change for a field the BOS does not handle', () => {
    const change = { field: 'account_review_update', value: { decision: 'APPROVED' } };
    expect(WhatsAppWebhook.safeParse(withChanges([change])).success).toBe(true);
  });

  it('refuses a message change that lacks what the worker needs', () => {
    const change = { field: 'messages', value: { messaging_product: 'whatsapp' } };
    expect(WhatsAppWebhook.safeParse(withChanges([change])).success).toBe(false);
  });

  it('refuses a delivery status outside the documented set', () => {
    const [, statusChange] = whatsapp.entry[0].changes as [Json, { value: { statuses: Json[] } }];
    const statuses = [{ ...statusChange.value.statuses[0], status: 'lost' }];
    const change = { ...statusChange, value: { ...statusChange.value, statuses } };
    expect(WhatsAppWebhook.safeParse(withChanges([change])).success).toBe(false);
  });
});

describe('Google lead form webhook', () => {
  it('keeps unknown keys and needs the form key', () => {
    const body = API_FIXTURES['webhooks.google'].request as Json;
    expect((GoogleLeadFormWebhook.parse({ ...body, asset_id: 9 }) as Json).asset_id).toBe(9);
    expect(GoogleLeadFormWebhook.safeParse({ ...body, google_key: undefined }).success).toBe(false);
  });
});

describe('Exotel callbacks', () => {
  const status = API_FIXTURES['webhooks.exotel.status'].request as Json;

  it('reads the terminal status and keeps new fields', () => {
    const parsed = ExotelCallStatusWebhook.parse({ ...status, AnsweredBy: 'human' }) as Json;
    expect(parsed.Status).toBe('completed');
    expect(parsed.AnsweredBy).toBe('human');
  });

  it('refuses a status the worker cannot map to a disposition', () => {
    expect(ExotelCallStatusWebhook.safeParse({ ...status, Status: 'voicemail' }).success).toBe(
      false,
    );
  });

  it('accepts a call that was not recorded', () => {
    expect(ExotelCallStatusWebhook.safeParse({ ...status, RecordingUrl: '' }).success).toBe(true);
  });

  it('takes only inbound calls on the incoming route', () => {
    const incoming = API_FIXTURES['webhooks.exotel.incoming'].request as Json;
    expect(ExotelIncomingWebhook.safeParse({ ...incoming, Direction: 'outbound' }).success).toBe(
      false,
    );
  });
});

describe('LiveKit webhook', () => {
  const event = API_FIXTURES['webhooks.livekit'].request as Json;

  it('reads 64-bit times sent as strings or numbers', () => {
    expect(LiveKitWebhook.safeParse({ ...event, createdAt: 1_790_500_900 }).success).toBe(true);
    expect(LiveKitWebhook.safeParse({ ...event, createdAt: 'yesterday' }).success).toBe(false);
  });

  it('refuses an event outside the documented set', () => {
    expect(LiveKitWebhook.safeParse({ ...event, event: 'room_exploded' }).success).toBe(false);
  });
});
