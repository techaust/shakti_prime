import { z } from 'zod';
import { IdSchema } from '../../ids';

/**
 * `platform.probe.run` (docs/design/phase1.md §5.2): the delivery check on Integration Health. It
 * emits `platform.probe.requested`, whose worker records when it arrived, so the page can show the
 * time from the command to the worker. It takes nothing.
 */
export const RunDeliveryProbeInput = z.object({}).strict();
export type RunDeliveryProbeInput = z.infer<typeof RunDeliveryProbeInput>;

/** The probe's id (the event's aggregate id) and the moment the command ran. */
export const DeliveryProbeDto = z
  .object({ probeId: IdSchema, requestedAt: z.iso.datetime() })
  .strict();
export type DeliveryProbeDto = z.infer<typeof DeliveryProbeDto>;
