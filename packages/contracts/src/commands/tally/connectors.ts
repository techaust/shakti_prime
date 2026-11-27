import { z } from 'zod';
import { TallyCompanySchema } from '../../api/connector';
import { EntityIdSchema, IdSchema } from '../../ids';

// TC2 Admin › Integrations › Tally (docs/03-roadmap-appendix/phase5.md §6.3): an Executive
// (`admin.integrations.write`) registers a connector, maps its Tally companies to the group's
// companies, rotates its key and revokes it. A key is made on the server (`newConnectorKey()`),
// shown once and never kept: the commands receive its SHA-256 and last four characters only.

/** A key's SHA-256 in lower-case hexadecimal, as `tally_connectors.key_hash` keeps it. */
export const ConnectorKeyHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
/** A key's last four characters, to tell keys apart on screen. */
export const ConnectorKeyHintSchema = z.string().regex(/^[A-Za-z0-9_-]{4}$/);

export const TallyConnectorNameSchema = z.string().trim().min(1).max(80);

/** One Tally company and the group's company its vouchers belong to. */
export const TallyCompanyMappingDto = z
  .object({
    tallyCompany: TallyCompanySchema,
    entityId: EntityIdSchema,
    reachable: z.boolean().nullable(),
    reportedAlterId: z.number().int().min(0).nullable(),
    reportedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type TallyCompanyMappingDto = z.infer<typeof TallyCompanyMappingDto>;

export const TallyConnectorDto = z
  .object({
    id: IdSchema,
    name: TallyConnectorNameSchema,
    keyHint: ConnectorKeyHintSchema,
    /** The new key's hint while a rotation waits for the old key to be retired. */
    nextKeyHint: ConnectorKeyHintSchema.nullable(),
    connectorVersion: z.string().nullable(),
    lastHeartbeatAt: z.iso.datetime().nullable(),
    revokedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    companies: z.array(TallyCompanyMappingDto),
  })
  .strict();
export type TallyConnectorDto = z.infer<typeof TallyConnectorDto>;

/** What the form sends; the action makes the key. */
export const RegisterTallyConnectorRequest = z
  .object({ name: TallyConnectorNameSchema })
  .strict();
export type RegisterTallyConnectorRequest = z.input<typeof RegisterTallyConnectorRequest>;

/** `tally.connector.register`. */
export const RegisterTallyConnectorInput = z
  .object({
    name: TallyConnectorNameSchema,
    keyHash: ConnectorKeyHashSchema,
    keyHint: ConnectorKeyHintSchema,
  })
  .strict();
export type RegisterTallyConnectorInput = z.input<typeof RegisterTallyConnectorInput>;

/** `tally.connector.map`: one Tally company to a company of the request. */
export const MapTallyCompanyInput = z
  .object({
    connectorId: IdSchema,
    tallyCompany: TallyCompanySchema,
    entityId: EntityIdSchema,
  })
  .strict();
export type MapTallyCompanyInput = z.input<typeof MapTallyCompanyInput>;

/** `tally.connector.unmap`: the company stops being served by the connector. */
export const UnmapTallyCompanyInput = z
  .object({ connectorId: IdSchema, entityId: EntityIdSchema })
  .strict();
export type UnmapTallyCompanyInput = z.input<typeof UnmapTallyCompanyInput>;

export const RotateTallyConnectorRequest = z.object({ connectorId: IdSchema }).strict();
export type RotateTallyConnectorRequest = z.input<typeof RotateTallyConnectorRequest>;

/** `tally.connector.rotate`: a new key, valid beside the current one until that is retired. */
export const RotateTallyConnectorInput = z
  .object({
    connectorId: IdSchema,
    keyHash: ConnectorKeyHashSchema,
    keyHint: ConnectorKeyHintSchema,
  })
  .strict();
export type RotateTallyConnectorInput = z.input<typeof RotateTallyConnectorInput>;

/** `tally.connector.retire_key` and `tally.connector.revoke`. */
export const TallyConnectorIdInput = z.object({ connectorId: IdSchema }).strict();
export type TallyConnectorIdInput = z.input<typeof TallyConnectorIdInput>;
