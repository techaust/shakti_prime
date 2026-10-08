import type { Principal } from '@shakti/contracts';
import type { IndexKnowledgeDeps } from '@shakti/domain';
import { hostedRuntime } from '../../auth/deps';
import { requireFileStore } from '../../files/uploads';
import { aiProvider } from '../../integrations/ai';
import { logger } from '../../log';
import { renderMaskedPages } from '../files/pdf-pages';
import { readWordText } from './read-word';

/**
 * What the index job runs with in this runtime: the worker principal of the upload's company, the
 * file store (none on a hosted runtime without S3: `integration_unavailable`, delivered again), the
 * provider wrapper (no key: the file is recorded unavailable), the Word reader and the drawing of
 * a masked PDF's pages.
 */
export function indexDeps(principal: Principal, requestId: string): IndexKnowledgeDeps {
  return {
    principal,
    store: requireFileStore(),
    provider: aiProvider(),
    readWord: readWordText,
    pdfPages: renderMaskedPages,
    requestId,
    hosted: hostedRuntime(),
    logger,
  };
}
