import { API_HEADERS, compareSemver, SemverSchema, type Semver } from '@shakti/contracts';
import { WORKSHOP_DEFAULTS } from '@shakti/domain';
import type { Env } from '../realtime/keys';

/**
 * The field app's version gate (FLD-03, docs/03-roadmap-appendix/phase4.md §6.4): every mobile
 * route refuses an app older than the minimum with `app_update_required`, before it reads anything
 * else. The minimum is `WORKSHOP_DEFAULTS.field.minimumAppVersion`, which a deployment raises with
 * `FIELD_MIN_APP_VERSION` when a release must reach every phone; `FIELD_LATEST_APP_VERSION` names
 * the newest release, which `GET /me` reports so the app can offer it.
 */
export const FIELD_VERSION_ENV = {
  minimum: 'FIELD_MIN_APP_VERSION',
  latest: 'FIELD_LATEST_APP_VERSION',
} as const;

export interface FieldAppVersions {
  minimum: Semver;
  latest: Semver;
}

function semverOf(value: string | undefined): Semver | undefined {
  const parsed = SemverSchema.safeParse(value?.trim());
  return parsed.success ? parsed.data : undefined;
}

/** The versions in force; an unreadable setting is left out, never a reason to refuse every app. */
export function fieldAppVersions(env: Env = process.env): FieldAppVersions {
  const minimum =
    semverOf(env[FIELD_VERSION_ENV.minimum]) ?? WORKSHOP_DEFAULTS.field.minimumAppVersion;
  const latest = semverOf(env[FIELD_VERSION_ENV.latest]);
  return {
    minimum,
    latest: latest !== undefined && compareSemver(latest, minimum) >= 0 ? latest : minimum,
  };
}

/**
 * Whether the app calling may be served: its `X-App-Version` (and, where the body names one too,
 * the older of the two) at the minimum or newer. An app that sends no readable version is refused
 * like an old one, since every release of the app sends it.
 */
export function appVersionAccepted(
  headers: Headers,
  minimum: Semver,
  bodyVersion?: string,
): boolean {
  const header = semverOf(headers.get(API_HEADERS.appVersion) ?? undefined);
  if (header === undefined || compareSemver(header, minimum) < 0) return false;
  if (bodyVersion === undefined) return true;
  const body = semverOf(bodyVersion);
  return body !== undefined && compareSemver(body, minimum) >= 0;
}
