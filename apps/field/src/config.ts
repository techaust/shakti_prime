import Constants from 'expo-constants';

/**
 * Where the app finds the BOS and which version it is. The address is the production one from
 * app.json unless the build names another (`EXPO_PUBLIC_API_BASE_URL`, the development profile in
 * eas.json); the version is the one app.json gives the build, sent as `X-App-Version`.
 */
export function apiBaseUrl(): string {
  const fromBuild: unknown = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (typeof fromBuild === 'string' && fromBuild !== '') return fromBuild;
  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: unknown } | undefined;
  return typeof extra?.apiBaseUrl === 'string'
    ? extra.apiBaseUrl
    : 'https://shaktiprime.com/api/v1';
}

export function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/** The app's page on the Play Store, where the update gate sends the engineer. */
export const STORE_URL = 'market://details?id=com.shaktiprime.field';
