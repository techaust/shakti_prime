import {
  DomainError,
  hasGrant,
  type PdfRenderJob,
  type Principal,
  type RenderedFilePurpose,
} from '@shakti/contracts';
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
import {
  documentType,
  printLabelSheet,
  type AttachContext,
  type DocumentTarget,
  type LabelsTarget,
  type LoadContext,
  type RegisteredDocument,
} from '../../print/documents';
import { istDay } from '../../screens/ist';
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

/**
 * A file already recorded for the job: a delivery that ran again answers it unchanged. A proof
 * page a newer one retired (`file_replaced`) is done for good: printing it again would put its
 * bank account back in the store under a record that can never be served.
 */
async function recorded(
  deps: RenderDeps,
  scope: { entityIds: number[]; requestId: string },
  fileId: string,
): Promise<{ outcome: RenderOutcome; retired: boolean } | undefined> {
  const file = await executeQuery(deps.principal, scope, (ctx) => getStoredFile(ctx, fileId), {
    name: 'print.render.recorded',
  });
  if (file?.status === 'rejected' && file.rejectReason === 'file_replaced') {
    return { outcome: { fileId, pages: 1, bytes: file.size }, retired: true };
  }
  if (file?.status !== 'ready') return undefined;
  const bytes = await deps.store.get(file.key);
  const pages = bytes === undefined ? 1 : pageCount(bytes);
  return { outcome: { fileId, pages, bytes: file.size }, retired: false };
}

/** What a job prints: its file's purpose and id, how it prints, and the record it attaches to. */
interface RenderPlan {
  purpose: RenderedFilePurpose;
  fileId: string;
  /** What the job's log line names besides its file. */
  logged: Record<string, string | number>;
  print: (
    ctx: LoadContext,
    renderer: () => Promise<PrintRenderer>,
  ) => Promise<{ pdf: Buffer; fileName: string; logged?: Record<string, string | number> }>;
  attach?: (fileId: string, ctx: AttachContext) => Promise<void>;
}

/** A document's plan, by its registered type; a type no loader prints is refused for good. */
function documentPlan(job: PdfRenderJob, target: DocumentTarget): RenderPlan {
  const registered: RegisteredDocument | undefined = documentType(target.documentType);
  if (registered === undefined) {
    throw new DomainError('not_found', `no loader prints ${target.documentType}`, {
      reason: 'document_type_unknown',
    });
  }
  const attach = registered.attach;
  return {
    purpose: registered.purpose,
    fileId: registered.fileId(job, target),
    logged: { documentType: target.documentType },
    print: async (ctx, renderer) => {
      const { document, fileName } = await registered.print(target, ctx);
      const pdf = await (await renderer()).renderPdf(document.html, document.options);
      return { pdf, fileName };
    },
    ...(attach === undefined
      ? {}
      : { attach: (fileId: string, ctx: AttachContext) => attach(target, fileId, ctx) }),
  };
}

/** A sheet of labels' plan (Q1): one label per page at the stock size, under the sheet's id. */
function labelsPlan(target: LabelsTarget): RenderPlan {
  return {
    purpose: 'label_sheet',
    fileId: target.sheetId,
    logged: { labelKind: target.labelKind, size: target.size },
    print: async (ctx, renderer) => {
      const sheet = await printLabelSheet(target, ctx);
      const pdf = await (await renderer()).renderLabel(sheet.html, sheet.size);
      return { pdf, fileName: sheet.fileName, logged: { labels: sheet.count } };
    },
  };
}

/**
 * Renders one document or one sheet of labels (ADR 0009, docs/03-roadmap-appendix/phase1.md
 * §6.4, phase3.md §7.4), as the worker principal of the job's company: its registered type loads
 * it, its template is printed by Chromium (A4 for a document, the label stock's size for labels),
 * the PDF is stored under its purpose and file id and recorded `ready` with
 * `files.document.record`, then attached to its record where the type has one (a quote's PDF,
 * `sales.quote.pdf.attach`). A job whose file is recorded already answers that file, so a repeated
 * delivery renders nothing. A type or label kind no loader prints is refused for good
 * (`not_found`); every other failure is retried by the queue and ends as the event's dead letter.
 */
export async function renderPdfJob(job: PdfRenderJob, deps: RenderDeps): Promise<RenderOutcome> {
  const log = deps.logger ?? appLogger;
  const started = Date.now();
  const target = job.target;
  const plan = target.kind === 'document' ? documentPlan(job, target) : labelsPlan(target);
  // Only the worker principal prints: nothing is loaded, rendered or stored for anyone else (the
  // record command refuses them too).
  if (!hasGrant(deps.principal.permissions, 'files.process', 'entity')) {
    throw new DomainError('forbidden', 'printing a document needs files.process');
  }
  if (!deps.principal.entityIds.includes(job.entityId) || deps.principal.entityIds.length !== 1) {
    throw new DomainError('forbidden', 'the worker acts for the job’s company alone');
  }
  const scope = { entityIds: [job.entityId], requestId: deps.requestId };
  const fileId = plan.fileId;
  const attachTo = {
    principal: deps.principal,
    entityId: job.entityId,
    requestId: deps.requestId,
    hosted: deps.hosted,
    store: deps.store,
  };
  const done = await recorded(deps, scope, fileId);
  if (done?.retired === true) {
    log.log('info', 'print.retired', { requestId: deps.requestId, eventId: job.eventId, fileId });
    return done.outcome;
  }
  if (done !== undefined) {
    // A delivery that ran again: the file stands; attaching it again changes nothing.
    await plan.attach?.(fileId, attachTo);
    return done.outcome;
  }

  const now = (deps.now ?? (() => new Date()))();
  const printed = await plan.print(
    {
      principal: deps.principal,
      entityId: job.entityId,
      requestId: deps.requestId,
      store: deps.store,
      cipher: deps.cipher,
      today: istDay(now),
    },
    deps.renderer,
  );

  const key = uploadKey(job.entityId, plan.purpose, fileId, 'application/pdf');
  await deps.store.put(key, printed.pdf, 'application/pdf');
  // The store keeps the first bytes put under a key; a delivery that ran again records those.
  const stored = (await deps.store.get(key)) ?? printed.pdf;
  await executeCommand(
    deps.principal,
    scope,
    recordRenderedFile,
    {
      entityId: job.entityId,
      fileId,
      purpose: plan.purpose,
      bucket: deps.store.bucket,
      key,
      name: printed.fileName,
      size: stored.length,
      sha256: sha256Hex(stored),
    },
    { hosted: deps.hosted },
  );
  await plan.attach?.(fileId, attachTo);
  const outcome = { fileId, pages: pageCount(stored), bytes: stored.length };
  log.log('info', 'print.rendered', {
    requestId: deps.requestId,
    eventId: job.eventId,
    ...plan.logged,
    ...printed.logged,
    fileId,
    pages: outcome.pages,
    bytes: outcome.bytes,
    durationMs: Date.now() - started,
  });
  return outcome;
}
