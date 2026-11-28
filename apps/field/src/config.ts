import Constants from 'expo-constants';
import { Platform } from 'react-native';

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

/** The phone as a sign-in names it, so Admin › Team members can tell one person's phones apart. */
export interface PhoneDetails {
  model?: string;
  osVersion?: string;
}

/** A value cut to the length the server keeps, or nothing when the phone gives none. */
function shortText(value: unknown, max: number): string | undefined {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return text === '' ? undefined : text.slice(0, max);
}

/** The phone's model and Android version, as React Native reads them (no other package needed). */
export function phoneDetails(): PhoneDetails {
  const constants = Platform.constants as unknown as Record<string, unknown>;
  const model = shortText(constants.Model, 80);
  const osVersion = shortText(constants.Release ?? Platform.Version, 20);
  return {
    ...(model === undefined ? {} : { model }),
    ...(osVersion === undefined ? {} : { osVersion }),
  };
}
