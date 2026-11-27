import type { Principal } from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  getStoredFile,
  notifyEvent,
  purchaseOrderMailTo,
  type FileStore,
  type Logger,
  type Mailer,
  type PurchaseOrderMailTo,
} from '@shakti/domain';
import { defaultAuthDeps } from '../auth/deps';
import { mailTranslator } from '../auth/mail-copy';
import { logger as appLogger } from '../log';
import { deliverNoticeBatch } from './notify/deliver-notices';

/** One purchase order sent by email, as its render job carries it, and the PDF stored for it. */
export interface PurchaseOrderMailJob {
  eventId: string;
  entityId: number;
  purchaseOrderId: string;
  vendorContactId: string;
  sentBy: string;
  /** The order's PDF as approved, which the render job has just stored or found stored. */
  fileId: string;
}

export interface PurchaseOrderMailDeps {
  /** Whom to mail, as the worker (`purchaseOrderMailTo`); undefined when nothing is to be mailed. */
  readTo: (job: PurchaseOrderMailJob) => Promise<PurchaseOrderMailTo | undefined>;
  /** The stored PDF's name and bytes, read as the worker; undefined when it cannot be had. */
  readPdf: (job: PurchaseOrderMailJob) => Promise<{ name: string; bytes: Uint8Array } | undefined>;
  mailer: Mailer;
  /** Tells the sender, in the notice centre and by push. */
  tellSender: (job: PurchaseOrderMailJob) => Promise<void>;
  logger: Logger;
}

export type PurchaseOrderMailOutcome = 'not_mailable' | 'mailed' | 'not_sent';

/** The mail step's ports, as the render worker of the job's company (`system:workers`). */
export function purchaseOrderMailDeps(
  principal: Principal,
  requestId: string,
  store: FileStore,
): PurchaseOrderMailDeps {
  const scope = (entityId: number) => ({ entityIds: [entityId], requestId });
  return {
    // The definer is the worker's, not the reading role's: on app_user, as the media sweep's.
    readTo: (job) =>
      executeQuery(
        principal,
        scope(job.entityId),
        (q) =>
          purchaseOrderMailTo(q, {
            purchaseOrderId: job.purchaseOrderId,
            vendorContactId: job.vendorContactId,
            sentBy: job.sentBy,
          }),
        { name: 'procurement.po.mail_to', pool: 'app_user' },
      ),
    readPdf: async (job) => {
      const file = await executeQuery(
        principal,
        scope(job.entityId),
        (q) => getStoredFile(q, job.fileId),
        { name: 'procurement.po.mail_pdf' },
      );
      if (
        file?.status !== 'ready' ||
        file.deletedAt !== null ||
        file.purpose !== 'purchase_order_pdf' ||
        file.entityId !== job.entityId
      ) {
        return undefined;
      }
      const bytes = await store.get(file.key);
      return bytes === undefined ? undefined : { name: file.name, bytes };
    },
    mailer: defaultAuthDeps().mailer,
    tellSender: async (job) => {
      const batch = await executeCommand(principal, scope(job.entityId), notifyEvent, {
        event: 'procurement.po.sent',
        entityId: job.entityId,
        eventId: job.eventId,
        purchaseOrderId: job.purchaseOrderId,
        sentBy: job.sentBy,
      });
      await deliverNoticeBatch(principal, batch, { requestId });
    },
    logger: appLogger,
  };
}

/**
 * The purchase order mailer (U2, review findings 4 and R2), the last step of the render job a
 * `procurement.po.sent` by email becomes: once the job has stored the order's PDF as approved (or
 * found it stored), the stored file is mailed to the vendor's person named, the sender's own
 * address to reply to. Until an environment's mailer is SES it is logged as every mail is (its
 * recipient and the file's name, never its bytes). An order that is no longer sent by email
 * (cancelled since) is not mailed. When the mail cannot go (the person has no address any more,
 * the file or the mail fails), the order stays sent and the sender is told once to send the PDF
 * themselves. Nothing here throws for a mail that did not go, so the job is not run again and the
 * vendor is never mailed twice; the job's event id is claimed once by the render route.
 */
export async function mailPurchaseOrder(
  job: PurchaseOrderMailJob,
  requestId: string,
  deps: PurchaseOrderMailDeps,
): Promise<PurchaseOrderMailOutcome> {
  const { purchaseOrderId } = job;
  const mail = await deps.readTo(job);
  if (mail === undefined) {
    deps.logger.log('info', 'procurement.po_mail_skipped', { requestId, purchaseOrderId });
    return 'not_mailable';
  }
  try {
    if (mail.to === null) throw new Error('the vendor’s person has no email address');
    const pdf = await deps.readPdf(job);
    if (pdf === undefined) throw new Error('the stored PDF could not be read');
    const t = mailTranslator();
    await deps.mailer.send({
      to: mail.to.email,
      subject: t('purchaseOrder.subject', { number: mail.poNo, company: mail.companyName }),
      text: t('purchaseOrder.body', {
        name: mail.to.name,
        number: mail.poNo,
        company: mail.companyName,
      }),
      ...(mail.replyTo === null ? {} : { replyTo: mail.replyTo }),
      attachments: [{ fileName: pdf.name, contentType: 'application/pdf', content: pdf.bytes }],
    });
    deps.logger.log('info', 'procurement.po_mailed', { requestId, purchaseOrderId });
    return 'mailed';
  } catch (error) {
    deps.logger.log('warn', 'procurement.po_mail_failed', {
      requestId,
      purchaseOrderId,
      error: error instanceof Error ? error.name : 'unknown',
    });
    await deps.tellSender(job);
    return 'not_sent';
  }
}
