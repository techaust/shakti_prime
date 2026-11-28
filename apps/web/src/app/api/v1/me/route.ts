import { defaultMobileDeps, meRoute } from '../../../../auth/mobile-routes';

export const dynamic = 'force-dynamic';

/**
 * The field app's caller: the person, their roles and grants per company, the feature flags and
 * the app versions the server accepts (docs/06-api.md §3.1).
 */
export function GET(request: Request): Promise<Response> {
  return meRoute(request, defaultMobileDeps());
}
