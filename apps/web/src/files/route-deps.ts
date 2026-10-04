import { commandOptions } from '../actions/support';
import { currentPrincipal } from '../auth/current-principal';
import { defaultAuthDeps } from '../auth/deps';
import type { FileRouteDeps } from './routes';
import { completeUploadFor, presignUpload } from './uploads';

/** The upload routes' real dependencies: the session, the shared store, the upload flow. */
export function fileRouteDeps(): FileRouteDeps {
  return {
    principal: currentPrincipal,
    keyValue: defaultAuthDeps().keyValue,
    presign: (principal, input, call) => presignUpload(principal, input, call),
    complete: (principal, fileId, input, call) =>
      completeUploadFor(principal, fileId, input.purpose, call),
    options: commandOptions,
  };
}
