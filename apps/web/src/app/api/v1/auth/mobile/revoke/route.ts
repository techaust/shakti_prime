import { defaultMobileDeps, mobileRevokeRoute } from '../../../../../../auth/mobile-routes';

export const dynamic = 'force-dynamic';

/** Signs this phone out of the field app (docs/06-api.md §3.1). */
export function POST(request: Request): Promise<Response> {
  return mobileRevokeRoute(request, defaultMobileDeps());
}
