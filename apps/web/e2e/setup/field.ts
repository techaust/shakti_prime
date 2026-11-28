// F1's phone fixtures (`e2e/field-phones.spec.ts`), written by the seed on the host as the table
// owner, as the auth module writes them: the snapshot phone at fixed times, and one phone per
// project signed in again on every run, so its journey always finds it to sign out. The refresh
// hashes are random: no token exists behind them.
import { newId } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';
import { randomBytes } from 'node:crypto';
import { FIELD_PHONES, PROJECTS, type ProjectName } from '../support/users';

type Sql = Parameters<Parameters<typeof asMigrator>[0]>[0];

async function signedInPhone(
  m: Sql,
  userId: string,
  phone: {
    deviceId: string;
    model: string;
    appVersion: string;
    signedInAt: string;
    lastSeenAt: string;
  },
): Promise<void> {
  const hash = randomBytes(32).toString('hex');
  await m`insert into mobile_devices (id, user_id, device_id, name, os_version, app_version,
            refresh_token_hash, refresh_family_id, refresh_expires_at, signed_in_at, last_seen_at)
          values (${newId()}, ${userId}, ${phone.deviceId}, ${phone.model}, '14', ${phone.appVersion},
                  ${hash}, ${newId()}, now() + interval '30 days', ${phone.signedInAt},
                  ${phone.lastSeenAt})
          on conflict (user_id, device_id) do update set
            name = excluded.name, app_version = excluded.app_version,
            refresh_token_hash = excluded.refresh_token_hash,
            refresh_family_id = excluded.refresh_family_id,
            refresh_expires_at = excluded.refresh_expires_at,
            previous_refresh_token_hash = null, refresh_rotated_at = null,
            signed_in_at = excluded.signed_in_at, last_seen_at = excluded.last_seen_at,
            revoked_at = null, revoked_reason = null, revoked_by = null`;
}

/** Makes the phone fixtures for the snapshot caller and each project's phone owner. */
export async function ensureFieldPhones(
  snapshotCallerId: string,
  owners: Record<ProjectName, string>,
): Promise<void> {
  await asMigrator(async (m) => {
    await signedInPhone(m, snapshotCallerId, FIELD_PHONES.snapshot);
    const now = new Date().toISOString();
    for (const project of PROJECTS) {
      await signedInPhone(m, owners[project], {
        deviceId: FIELD_PHONES.owners[project].deviceId,
        model: FIELD_PHONES.ownerModel,
        appVersion: '1.0.0',
        signedInAt: now,
        lastSeenAt: now,
      });
    }
  });
}
