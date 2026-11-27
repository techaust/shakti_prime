import { defaultMobileDeps, mobileTokenRoute } from '../../../../../../auth/mobile-routes';

export const dynamic = 'force-dynamic';

/** Exchanges the field app's email, password and second factor for a token pair bound to the phone (docs/06-api.md §3.1). */
export function POST(request: Request): Promise<Response> {
  return mobileTokenRoute(request, defaultMobileDeps());
}
