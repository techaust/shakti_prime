import { hostedRuntime } from '../../../../../../auth/deps';
import { localDownload, localUpload } from '../../../../../../files/local-route';
import { fileStore, localFilesSecret } from '../../../../../../files/store';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ token: string }>;
}

/**
 * The development file store's upload and download addresses (docs/API.md §3.2). Only a
 * developer's machine answers; every hosted deployment answers 404.
 */
export async function PUT(request: Request, { params }: Params): Promise<Response> {
  const { token } = await params;
  return localUpload(request, token, {
    store: fileStore(),
    secret: localFilesSecret(),
    hosted: hostedRuntime(),
  });
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { token } = await params;
  return localDownload(request, token, {
    store: fileStore(),
    secret: localFilesSecret(),
    hosted: hostedRuntime(),
  });
}
