import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';
import { GeoPointSchema } from './common';

/**
 * `POST /attendance/check-in` (docs/API.md §3.2, docs/BLUEPRINT.md §8.9): office attendance by
 * geofence and selfie, or a field check-in at the job site. Recorded offline with the device's
 * time and position, and sent when the app is back online.
 */
export const ATTENDANCE_EVENT_TYPES = ['office_in', 'office_out', 'site_in', 'site_out'] as const;
export const AttendanceEventTypeSchema = z.enum(ATTENDANCE_EVENT_TYPES);
export type AttendanceEventType = z.infer<typeof AttendanceEventTypeSchema>;

export const CheckInRequest = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    type: AttendanceEventTypeSchema,
    at: z.iso.datetime(),
    geo: GeoPointSchema,
    /** A `selfie` file already completed through `/files/:id/complete`. */
    selfieFileId: IdSchema,
    siteId: IdSchema.optional(),
    projectId: IdSchema.optional(),
  })
  .strict()
  .refine((v) => !v.type.startsWith('site_') || v.siteId !== undefined, {
    message: 'a site check-in names the site',
    path: ['siteId'],
  });
export type CheckInRequest = z.infer<typeof CheckInRequest>;

/**
 * The event is always recorded; `withinGeofence` false sends it to the manager as a regularisation
 * item instead of refusing it, because a field engineer may be offline at a remote site.
 */
export const CheckInResponse = z
  .object({
    id: IdSchema,
    recordedAt: z.iso.datetime(),
    withinGeofence: z.boolean(),
    distanceM: z.number().int().min(0).nullable(),
    needsReview: z.boolean(),
  })
  .strict();
export type CheckInResponse = z.infer<typeof CheckInResponse>;
