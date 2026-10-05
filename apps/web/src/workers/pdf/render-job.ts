import { DomainError, hasGrant, type PdfRenderJob, type Principal } from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  getStoredFile,
  recordRenderedFile,
  sha256Hex,
  uploadKey,
  type FieldCipher,
  type FileStore,
  type Logger,
} from '@shakti/domain';
import { logger as appLogger } from '../../log';
import { documentType, type RegisteredDocument } from '../../print/documents';
import { istDay } from '../../print/format';
import { pageCount, type PrintRenderer } from '../../print/renderer';

/** What a render job is given: the worker principal of its company and the runtime's ports. */
export interface RenderDeps {
  /** `system:workers` for the job's company (`files.process`), never a person. */
  principal: Principal;
  requestId: string;
  store: FileStore;
  cipher: FieldCipher | undefined;
  /** The warm renderer of this process; opened on first use. */
  renderer: () => Promise<PrintRenderer>;
  hosted: boolean;
  now?: () => Date;
  logger?: Logger;
}

export interface RenderOutcome {
  fileId: string;
  pages: number;
  bytes: number;
}

/** A file already recorded for the job: a delivery that ran again answers it unchanged. */
async function recorded(
  deps: RenderDeps,
  scope: { entityIds: number[]; requestId: string },
  fileId: string,
): Promise<RenderOutcome | undefined> {
  const file = await executeQuery(deps.principal, scope, (ctx) => getStoredFile(ctx, fileId), {
    name: 'print.render.recorded',
  });
  if (file?.status !== 'ready') return undefined;
  const bytes = await deps.store.get(file.key);
  return { fileId, pages: bytes === undefined ? 1 : pageCount(bytes), bytes: file.size };
}

/**
 * Renders one document (ADR 0009, docs/design/phase1.md §6.4), as the worker principal of the
 * job's company: its registered type loads it, its template is printed by Chromium, the PDF is
 * stored under its purpose and file id and recorded `ready` with `files.document.record`, then
 * attached to its record where the type has one (a quote's PDF, `sales.quote.pdf.attach`). A job
 * whose file is recorded already answers that file, so a repeated delivery renders nothing. A type
 * no loader prints, or a label sheet, is refused for good (`not_found`); every other failure is
 * retried by the queue and ends as the event's dead letter.
 */
export async function renderPdfJob(job: PdfRenderJob, deps: RenderDeps): Promise<RenderOutcome> {
  const log = deps.logger ?? appLogger;
  const started = Date.now();
  if (job.target.kind !== 'document') {
    throw new DomainError('not_found', 'label sheets are not printed yet', {
      reason: 'document_type_unknown',
    });
  }
  const target = job.target;
  const registered: RegisteredDocument | undefined = documentType(target.documentType);
  if (registered === undefined) {
    throw new DomainError('not_found', `no loader prints ${target.documentType}`, {
      reason: 'document_type_unknown',
    });
  }
  // Only the worker principal prints: nothing is loaded, rendered or stored for anyone else (the
  // record command refuses them too).
  if (!hasGrant(deps.principal.permissions, 'files.process', 'entity')) {
    throw new DomainError('forbidden', 'printing a document needs files.process');
  }
  if (!deps.principal.entityIds.includes(job.entityId) || deps.principal.entityIds.length !== 1) {
    throw new DomainError('forbidden', 'the worker acts for the job’s company alone');
  }
  const scope = { entityIds: [job.entityId], requestId: deps.requestId };
  const fileId = registered.fileId(job, target);
  const attachTo = {
    principal: deps.principal,
    entityId: job.entityId,
    requestId: deps.requestId,
    hosted: deps.hosted,
  };
  const done = await recorded(deps, scope, fileId);
  if (done !== undefined) {
    // A delivery that ran again: the file stands; attaching it again changes nothing.
    await registered.attach?.(target, fileId, attachTo);
    return done;
  }

  const now = (deps.now ?? (() => new Date()))();
  const { document, fileName } = await registered.print(target, {
    principal: deps.principal,
    entityId: job.entityId,
    requestId: deps.requestId,
    store: deps.store,
    cipher: deps.cipher,
    today: istDay(now),
  });
  const renderer = await deps.renderer();
  const pdf = await renderer.renderPdf(document.html, document.options);

  const key = uploadKey(job.entityId, registered.purpose, fileId, 'application/pdf');
  await deps.store.put(key, pdf, 'application/pdf');
  // The store keeps the first bytes put under a key; a delivery that ran again records those.
  const stored = (await deps.store.get(key)) ?? pdf;
  await executeCommand(
    deps.principal,
    scope,
    recordRenderedFile,
    {
      entityId: job.entityId,
      fileId,
      purpose: registered.purpose,
      bucket: deps.store.bucket,
      key,
      name: fileName,
      size: stored.length,
      sha256: sha256Hex(stored),
    },
    { hosted: deps.hosted },
  );
  await registered.attach?.(target, fileId, attachTo);
  const outcome = { fileId, pages: pageCount(stored), bytes: stored.length };
  log.log('info', 'print.rendered', {
    requestId: deps.requestId,
    eventId: job.eventId,
    documentType: target.documentType,
    fileId,
    pages: outcome.pages,
    bytes: outcome.bytes,
    durationMs: Date.now() - started,
  });
  return outcome;
}
