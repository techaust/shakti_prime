import { completeRoute } from '../../../../../../files/routes';
import { fileRouteDeps } from '../../../../../../files/route-deps';

export const dynamic = 'force-dynamic';

/** `POST /api/v1/files/:id/complete` (docs/06-api.md §3.2): the upload landed; its checks start. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return completeRoute(request, await params, fileRouteDeps());
}
