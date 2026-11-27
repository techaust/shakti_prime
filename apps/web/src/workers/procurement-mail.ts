import type { DeliveredEvent, Principal } from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  getPurchaseOrderForMail,
  notifyEvent,
  type Logger,
  type Mailer,
  type PurchaseOrderMail,
  type PurchaseOrderPrintData,
} from '@shakti/domain';
import { defaultAuthDeps } from '../auth/deps';
import { mailTranslator } from '../auth/mail-copy';
import { logger as appLogger } from '../log';
import { purchaseOrderPdfFileName } from '../print/purchase-order-file';
import { deliverNoticeBatch } from './notify/deliver-notices';

interface MailRead {
  entityId: number;
  purchaseOrderId: string;
  vendorContactId: string;
  sentBy: string;
}

export interface PurchaseOrderMailDeps {
  /** The vendor's copy, as the worker (`getPurchaseOrderForMail`). */
  read: (input: MailRead) => Promise<PurchaseOrderMail | undefined>;
  mailer: Mailer;
  /** The order's PDF from its print data (`purchaseOrderPdf`, Chromium). */
  pdf: (data: PurchaseOrderPrintData, requestId: string) => Promise<Uint8Array>;
  /** Tells the sender, in the notice centre and by push. */
  tellSender: (input: {
    entityId: number;
    eventId: string;
    purchaseOrderId: string;
    sentBy: string;
  }) => Promise<void>;
  logger: Logger;
}

export type PurchaseOrderMailOutcome = 'by_hand' | 'not_mailable' | 'mailed' | 'not_sent';

function defaultDeps(principal: Principal, requestId: string): PurchaseOrderMailDeps {
  return {
    read: ({ entityId, ...input }) =>
      executeQuery(
        principal,
        { entityIds: [entityId], requestId },
        (q) => getPurchaseOrderForMail(q, input),
        { name: 'procurement.po.mail' },
      ),
    mailer: defaultAuthDeps().mailer,
    pdf: async (data, id) => {
      // Loaded on first use, so Chromium's driver stays out of every other worker's start.
      const { purchaseOrderPdf } = await import('../print/purchase-order-pdf');
      return purchaseOrderPdf(data, id);
    },
    tellSender: async (input) => {
      const batch = await executeCommand(
        principal,
        { entityIds: [input.entityId], requestId },
        notifyEvent,
        { event: 'procurement.po.sent', ...input },
      );
      await deliverNoticeBatch(principal, batch, { requestId });
    },
    logger: appLogger,
  };
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * The purchase order mailer (U2, review finding 4), on `procurement.po.sent`: an order sent by
 * email is printed with its rates (the vendor's copy, read through the one narrow definer the
 * worker's platform-only `procurement.po.mail` opens) on the company's letterhead and mailed to
 * the vendor's person named, the sender's own address to reply to. Until an environment's mailer
 * is SES it is logged as every mail is (its recipient and the file's name, never its bytes). An
 * order sent by hand is left alone; one that is no longer sent by email (cancelled since) is not
 * mailed. When the mail cannot go (the person has no address any more, the PDF or the mail
 * fails), the order stays sent and the sender is told once to send the PDF themselves. Each event
 * is handled once by its id, so a repeat does not mail twice.
 */
export async function handlePurchaseOrderSent(
  event: DeliveredEvent,
  ctx: { principal: Principal; requestId: string },
  deps: PurchaseOrderMailDeps = defaultDeps(ctx.principal, ctx.requestId),
): Promise<PurchaseOrderMailOutcome> {
  const contactId = text(event.payload.vendorContactId);
  const sentBy = text(event.payload.sentBy);
  if (event.payload.via !== 'email' || contactId === undefined || sentBy === undefined) {
    return 'by_hand';
  }
  const purchaseOrderId = event.aggregateId;
  const mail = await deps.read({
    entityId: event.entityId,
    purchaseOrderId,
    vendorContactId: contactId,
    sentBy,
  });
  if (mail === undefined) {
    deps.logger.log('info', 'procurement.po_mail_skipped', {
      requestId: ctx.requestId,
      purchaseOrderId,
    });
    return 'not_mailable';
  }
  try {
    if (mail.to === null) throw new Error('the vendor’s person has no email address');
    const { order, company } = mail.print;
    const content = await deps.pdf(mail.print, ctx.requestId);
    const t = mailTranslator();
    await deps.mailer.send({
      to: mail.to.email,
      subject: t('purchaseOrder.subject', { number: order.poNo, company: company.legalName }),
      text: t('purchaseOrder.body', {
        name: mail.to.name,
        number: order.poNo,
        company: company.legalName,
      }),
      ...(mail.replyTo === null ? {} : { replyTo: mail.replyTo }),
      attachments: [
        {
          fileName: purchaseOrderPdfFileName(order.poNo),
          contentType: 'application/pdf',
          content,
        },
      ],
    });
    deps.logger.log('info', 'procurement.po_mailed', { requestId: ctx.requestId, purchaseOrderId });
    return 'mailed';
  } catch (error) {
    deps.logger.log('warn', 'procurement.po_mail_failed', {
      requestId: ctx.requestId,
      purchaseOrderId,
      error: error instanceof Error ? error.name : 'unknown',
    });
    await deps.tellSender({ entityId: event.entityId, eventId: event.id, purchaseOrderId, sentBy });
    return 'not_sent';
  }
}
