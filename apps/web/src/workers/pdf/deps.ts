import type { Principal } from '@shakti/contracts';
import { hostedRuntime } from '../../auth/deps';
import { fieldCipher } from '../../crypto/kms-cipher';
import { requireFileStore } from '../../files/uploads';
import { sharedPrintRenderer } from '../../print/renderer';
import type { RenderDeps } from './render-job';

/**
 * The runtime's ports for a render job: the file store (`integration_unavailable` without one,
 * retried), the field cipher, this process's warm Chromium, and whether the runtime is hosted.
 */
export function renderDeps(principal: Principal, requestId: string): RenderDeps {
  return {
    principal,
    requestId,
    store: requireFileStore(),
    cipher: fieldCipher(),
    renderer: sharedPrintRenderer,
    hosted: hostedRuntime(),
  };
}
