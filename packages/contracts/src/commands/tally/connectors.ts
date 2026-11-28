import { z } from 'zod';
import { AlterIdSchema, TallyCompanyProblemSchema, TallyCompanySchema } from '../../api/connector';
import { EntityIdSchema, IdSchema } from '../../ids';

// TC2 Admin › Integrations › Tally (docs/03-roadmap-appendix/phase5.md §6.3): an Executive
// (`admin.integrations.write`) registers a connector, maps its Tally companies to the group's
// companies, rotates its key and revokes it. A key is made on the server (`newConnectorKey()`) and
// shown once; the command seals it with the field cipher (KMS on a hosted environment) before it
// is stored, and no audit row, log or answer holds it.

/** A connector's key: 32 random bytes in base64url, as the connector signs with it. */
export const ConnectorKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
/** A key's last four characters, to tell keys apart on screen. */
export const ConnectorKeyHintSchema = z.string().regex(/^[A-Za-z0-9_-]{4}$/);

export const TallyConnectorNameSchema = z.string().trim().min(1).max(80);

/** One Tally company and the group's company its vouchers belong to, with what it last reported. */
export const TallyCompanyMappingDto = z
  .object({
    tallyCompany: TallyCompanySchema,
    entityId: EntityIdSchema,
    reachable: z.boolean().nullable(),
    /** The BOS's cursor for the company. */
    lastAlterId: AlterIdSchema,
    /** Tally's own last AlterID, from the heartbeat; the lag is this less `lastAlterId`. */
    tallyLastAlterId: AlterIdSchema.nullable(),
    problem: TallyCompanyProblemSchema.nullable(),
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
    tallyVersion: z.string().nullable(),
    queueDepth: z.number().int().min(0).nullable(),
    /** Outbox rows the connector set aside in the last 7 days. */
    heldRows: z.number().int().min(0).nullable(),
    lastHeartbeatAt: z.iso.datetime().nullable(),
    revokedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    companies: z.array(TallyCompanyMappingDto),
  })
  .strict();
export type TallyConnectorDto = z.infer<typeof TallyConnectorDto>;

/** What the form sends; the action makes the key. */
export const RegisterTallyConnectorRequest = z.object({ name: TallyConnectorNameSchema }).strict();
export type RegisterTallyConnectorRequest = z.input<typeof RegisterTallyConnectorRequest>;

/** `tally.connector.register`: the name and the key the action made, sealed by the command. */
export const RegisterTallyConnectorInput = z
  .object({
    name: TallyConnectorNameSchema,
    key: ConnectorKeySchema,
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

/** `tally.connector.unmap`: one Tally company stops being served by the connector. */
export const UnmapTallyCompanyInput = z
  .object({ connectorId: IdSchema, entityId: EntityIdSchema, tallyCompany: TallyCompanySchema })
  .strict();
export type UnmapTallyCompanyInput = z.input<typeof UnmapTallyCompanyInput>;

export const RotateTallyConnectorRequest = z.object({ connectorId: IdSchema }).strict();
export type RotateTallyConnectorRequest = z.input<typeof RotateTallyConnectorRequest>;

/** `tally.connector.rotate`: a new key, valid beside the current one until that is retired. */
export const RotateTallyConnectorInput = z
  .object({
    connectorId: IdSchema,
    key: ConnectorKeySchema,
  })
  .strict();
export type RotateTallyConnectorInput = z.input<typeof RotateTallyConnectorInput>;

/** `tally.connector.retire_key` and `tally.connector.revoke`. */
export const TallyConnectorIdInput = z.object({ connectorId: IdSchema }).strict();
export type TallyConnectorIdInput = z.input<typeof TallyConnectorIdInput>;
