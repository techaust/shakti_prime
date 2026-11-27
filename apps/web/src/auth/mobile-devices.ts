import {
  newId,
  type MobileAccountChangeReason,
  type MobileDevice,
  type MobileDeviceRevokeReason,
} from '@shakti/contracts';
import { authDb, mobileDevices } from '@shakti/db/auth';
import { and, eq, isNull, ne } from 'drizzle-orm';

/**
 * The phones the field app signs in from, as the auth module keeps them in `mobile_devices` through
 * the `auth_service` connection (docs/03-roadmap-appendix/phase4.md §6.4). Only the refresh token's
 * hash is stored. One installation holds one person's tokens at a time, so a sign-in signs out any
 * other person's live row on the same installation.
 */

/**
 * How long after a rotation the token it replaced is still taken as a retry whose answer was lost,
 * rather than as reuse (the lead's decision of 27-11-2026 on the early check).
 */
export const RETRY_SECONDS = 120;

/** What happened to a refresh token presented with its installation's id. */
export type RotateOutcome =
  | { kind: 'rotated'; userId: string; deviceId: string }
  /**
   * The token the last rotation replaced, presented again within `RETRY_SECONDS` of it: a retry
   * whose answer was lost. Nothing changes; the route answers that rotation's pair again.
   */
  | { kind: 'retried'; userId: string; deviceId: string; expiresAt: Date }
  /** The installation's live token, past its 30 days: the person signs in again. */
  | { kind: 'expired' }
  /**
   * Not the installation's live token: one already rotated away (presented a second time), or a
   * live token sent with another installation's id. The live row is revoked (`refresh_reused`).
   */
  | { kind: 'reused'; userId: string }
  /** The token of a phone already signed out. */
  | { kind: 'revoked' }
  /** Nothing is known of the token or the installation. */
  | { kind: 'unknown' };

export interface DeviceSignIn {
  userId: string;
  device: MobileDevice;
  refreshHash: string;
  expiresAt: Date;
  now: Date;
}

export interface DeviceRotation {
  deviceId: string;
  presentedHash: string;
  newHash: string;
  expiresAt: Date;
  appVersion: string;
  now: Date;
}

/** Where a phone stands for an access token: live since `signedInAt`, signed out, or unknown. */
export type DeviceStanding =
  { kind: 'live'; signedInAt: Date } | { kind: 'revoked' } | { kind: 'unknown' };

export interface DeviceStore {
  /** Signs the installation in for the person with a new token family; answers the row's id. */
  signIn(input: DeviceSignIn): Promise<string>;
  /** Rotates the installation's refresh token when the presented one is its live token. */
  rotate(input: DeviceRotation): Promise<RotateOutcome>;
  /** Signs the person's phone out; false when it was not signed in. */
  signOut(
    userId: string,
    deviceId: string,
    reason: MobileDeviceRevokeReason,
    now: Date,
  ): Promise<boolean>;
  standing(userId: string, deviceId: string): Promise<DeviceStanding>;
  /**
   * Signs every phone of the person out when their password changes or is reset, as their website
   * sessions end (SECURITY §2); answers how many were signed in. The commands that end sessions
   * (`revokeUserSessions` in the domain) sign the phones out in their own transaction.
   */
  signOutEverywhere(userId: string, reason: MobileAccountChangeReason, now: Date): Promise<number>;
}

const d = mobileDevices;

export const authDeviceStore: DeviceStore = {
  async signIn(input) {
    const id = newId();
    return authDb().transaction(async (tx) => {
      // Another person's tokens on this installation end with this sign-in.
      await tx
        .update(d)
        .set({ revokedAt: input.now, revokedReason: 'signed_out' })
        .where(
          and(
            eq(d.deviceId, input.device.deviceId),
            ne(d.userId, input.userId),
            isNull(d.revokedAt),
          ),
        );
      const fields = {
        platform: input.device.platform,
        name: input.device.model ?? null,
        osVersion: input.device.osVersion ?? null,
        appVersion: input.device.appVersion,
        refreshTokenHash: input.refreshHash,
        refreshFamilyId: newId(),
        previousRefreshTokenHash: null,
        refreshRotatedAt: null,
        refreshExpiresAt: input.expiresAt,
        signedInAt: input.now,
        pushToken: input.device.pushToken ?? null,
        lastSeenAt: input.now,
        revokedAt: null,
        revokedReason: null,
        revokedBy: null,
      };
      const [row] = await tx
        .insert(d)
        .values({ id, userId: input.userId, deviceId: input.device.deviceId, ...fields })
        .onConflictDoUpdate({ target: [d.userId, d.deviceId], set: fields })
        .returning({ id: d.id });
      if (!row) throw new Error('the phone was not signed in');
      return row.id;
    });
  },

  async rotate(input) {
    return authDb().transaction(async (tx) => {
      // The installation's live row, locked: a second refresh with the same token waits here and
      // then finds the token rotated away, so only one of them ever gets a new pair.
      const [live] = await tx
        .select({
          id: d.id,
          userId: d.userId,
          hash: d.refreshTokenHash,
          expiresAt: d.refreshExpiresAt,
          previousHash: d.previousRefreshTokenHash,
          rotatedAt: d.refreshRotatedAt,
        })
        .from(d)
        .where(and(eq(d.deviceId, input.deviceId), isNull(d.revokedAt)))
        .limit(1)
        .for('update');
      if (live?.hash === input.presentedHash) {
        if (live.expiresAt.getTime() <= input.now.getTime()) return { kind: 'expired' };
        await tx
          .update(d)
          .set({
            refreshTokenHash: input.newHash,
            refreshExpiresAt: input.expiresAt,
            previousRefreshTokenHash: live.hash,
            refreshRotatedAt: input.now,
            appVersion: input.appVersion,
            lastSeenAt: input.now,
          })
          .where(eq(d.id, live.id));
        return { kind: 'rotated', userId: live.userId, deviceId: input.deviceId };
      }
      // The token the last rotation replaced, again, soon after: its answer was lost on the way.
      // The rotation's token is derived from this one, so the same new hash proves it is that
      // rotation's retry; the pair is answered again and the row stays as it is.
      if (
        live?.previousHash === input.presentedHash &&
        live.rotatedAt !== null &&
        input.now.getTime() - live.rotatedAt.getTime() <= RETRY_SECONDS * 1000 &&
        live.hash === input.newHash
      ) {
        return {
          kind: 'retried',
          userId: live.userId,
          deviceId: input.deviceId,
          expiresAt: live.expiresAt,
        };
      }
      const [holder] = await tx
        .select({ id: d.id, userId: d.userId, revokedAt: d.revokedAt })
        .from(d)
        .where(eq(d.refreshTokenHash, input.presentedHash))
        .limit(1)
        .for('update');
      if (holder !== undefined && holder.revokedAt !== null) return { kind: 'revoked' };
      // A live token sent from another installation, or a retired token of this one: either way
      // someone else may hold it, so the family it belongs to ends.
      const target = holder ?? live;
      if (target !== undefined) {
        await tx
          .update(d)
          .set({ revokedAt: input.now, revokedReason: 'refresh_reused' })
          .where(and(eq(d.id, target.id), isNull(d.revokedAt)));
        return { kind: 'reused', userId: target.userId };
      }
      const [signedOut] = await tx
        .select({ id: d.id })
        .from(d)
        .where(eq(d.deviceId, input.deviceId))
        .limit(1);
      return signedOut === undefined ? { kind: 'unknown' } : { kind: 'revoked' };
    });
  },

  async signOut(userId, deviceId, reason, now) {
    const rows = await authDb()
      .update(d)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(d.userId, userId), eq(d.deviceId, deviceId), isNull(d.revokedAt)))
      .returning({ id: d.id });
    return rows.length > 0;
  },

  async signOutEverywhere(userId, reason, now) {
    const rows = await authDb()
      .update(d)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(d.userId, userId), isNull(d.revokedAt)))
      .returning({ id: d.id });
    return rows.length;
  },

  async standing(userId, deviceId) {
    const [row] = await authDb()
      .select({ signedInAt: d.signedInAt, revokedAt: d.revokedAt })
      .from(d)
      .where(and(eq(d.userId, userId), eq(d.deviceId, deviceId)))
      .limit(1);
    if (row === undefined) return { kind: 'unknown' };
    return row.revokedAt === null
      ? { kind: 'live', signedInAt: row.signedInAt }
      : { kind: 'revoked' };
  },
};
