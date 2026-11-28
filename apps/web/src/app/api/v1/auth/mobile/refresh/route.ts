import { defaultMobileDeps, mobileRefreshRoute } from '../../../../../../auth/mobile-routes';

export const dynamic = 'force-dynamic';

/** Rotates the field app's refresh token: a token presented twice signs the phone out (docs/06-api.md §3.1). */
export function POST(request: Request): Promise<Response> {
  return mobileRefreshRoute(request, defaultMobileDeps());
}
