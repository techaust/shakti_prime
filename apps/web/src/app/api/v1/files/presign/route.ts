import { fileRouteDeps } from '../../../../../files/route-deps';
import { presignRoute } from '../../../../../files/routes';

export const dynamic = 'force-dynamic';

/** `POST /api/v1/files/presign` (docs/06-api.md §3.2): a signed upload address for one file. */
export function POST(request: Request): Promise<Response> {
  return presignRoute(request, fileRouteDeps());
}
