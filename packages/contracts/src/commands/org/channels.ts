import { z } from 'zod';
import { E164Schema, PhoneInputSchema } from '../../crm/phone';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * A company's channels (docs/03-roadmap-appendix/phase2.md §5.2): its WhatsApp number, its
 * DLT-registered 140-series (promotional) and 160-series (service) calling numbers, and its IVR
 * and missed-call numbers. `entity_channels_channel_check` lists the same values.
 */
export const ENTITY_CHANNEL_KINDS = [
  'whatsapp',
  'call_promo_140',
  'call_service_160',
  'ivr',
  'missed_call',
] as const;
export const EntityChannelKindSchema = z.enum(ENTITY_CHANNEL_KINDS);
export type EntityChannelKind = z.infer<typeof EntityChannelKindSchema>;

/**
 * How a provider names the number: WhatsApp's `phone_number_id`, Exotel's ExoPhone sid. Letters,
 * digits and `_ . : -`, as `entity_channels_provider_ref_check` allows.
 */
export const ChannelProviderRefSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:-]{1,64}$/);

/** The header registered on DLT for the number, kept for the record. */
export const DltHeaderSchema = z.string().trim().min(1).max(40);

/**
 * `org.channel.set`: an Executive records a company's number on one channel. A number already in
 * use on the channel is updated in place (its provider reference, DLT header and verification); a
 * different number takes its place, the old one kept as out of use. `verified` marks that the
 * Executive confirmed the number works on this channel; a new number starts unverified unless sent.
 * `null` clears an optional field; leaving one out keeps it.
 */
export const SetEntityChannelInput = z
  .object({
    entityId: EntityIdSchema,
    channel: EntityChannelKindSchema,
    number: PhoneInputSchema,
    providerRef: ChannelProviderRefSchema.nullable().optional(),
    dltHeader: DltHeaderSchema.nullable().optional(),
    verified: z.boolean(),
  })
  .strict();
export type SetEntityChannelInput = z.input<typeof SetEntityChannelInput>;

/** `org.channel.archive`: the number is taken out of use; calls and threads that named it keep it. */
export const ArchiveEntityChannelInput = z
  .object({
    entityId: EntityIdSchema,
    channelId: IdSchema,
  })
  .strict();
export type ArchiveEntityChannelInput = z.input<typeof ArchiveEntityChannelInput>;

/** A company's number on one channel, as Settings › Companies › Channels shows it. */
export const EntityChannelDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    channel: EntityChannelKindSchema,
    numberE164: E164Schema,
    providerRef: z.string().nullable(),
    dltHeader: z.string().nullable(),
    isActive: z.boolean(),
    verifiedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type EntityChannelDto = z.infer<typeof EntityChannelDto>;

/** `org.channel.list`: the company's numbers in use, in the order of `ENTITY_CHANNEL_KINDS`. */
export const ListEntityChannelsInput = z.object({ entityId: EntityIdSchema }).strict();
export type ListEntityChannelsInput = z.input<typeof ListEntityChannelsInput>;
