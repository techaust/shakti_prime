import { newId } from '@shakti/contracts';
import { memoryMailer, type Logger, type PurchaseOrderMailTo } from '@shakti/domain';
import { describe, expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import {
  mailPurchaseOrder,
  type PurchaseOrderMailDeps,
  type PurchaseOrderMailJob,
} from './procurement-mail';

const quiet: Logger = { log: () => undefined };
const PDF = new Uint8Array([37, 80, 68, 70]);

const job: PurchaseOrderMailJob = {
  eventId: newId(),
  entityId: 1,
  purchaseOrderId: newId(),
  vendorContactId: newId(),
  sentBy: newId(),
  fileId: newId(),
};

function mailTo(to: PurchaseOrderMailTo['to']): PurchaseOrderMailTo {
  return {
    poNo: 'SS/PO/2026-27/0007',
    companyName: 'Shakti Supreme Private Limited',
    to,
    replyTo: 'buyer@shakti.example.in',
  };
}

function deps(
  read: PurchaseOrderMailTo | undefined,
  overrides: Partial<PurchaseOrderMailDeps> = {},
) {
  const mailer = memoryMailer();
  const tellSender = vi.fn<PurchaseOrderMailDeps['tellSender']>().mockResolvedValue(undefined);
  const readTo = vi.fn<PurchaseOrderMailDeps['readTo']>().mockResolvedValue(read);
  const readPdf = vi
    .fn<PurchaseOrderMailDeps['readPdf']>()
    .mockResolvedValue({ name: 'Purchase order SS-PO-2026-27-0007.pdf', bytes: PDF });
  const all: PurchaseOrderMailDeps = {
    readTo,
    readPdf,
    mailer,
    tellSender,
    logger: quiet,
    ...overrides,
  };
  return { all, mailer, tellSender, readTo, readPdf };
}

describe('the purchase order mailer (review findings 4 and R2)', () => {
  it('mails the vendor’s person the stored PDF, with the sender’s address to reply to', async () => {
    const d = deps(mailTo({ name: 'Sales desk', email: 'sales@vendor.example.in' }));
    expect(await mailPurchaseOrder(job, 'req-1', d.all)).toBe('mailed');
    expect(d.readTo).toHaveBeenCalledWith(job);
    expect(d.readPdf).toHaveBeenCalledWith(job);
    expect(d.mailer.sent).toHaveLength(1);
    const [message] = d.mailer.sent;
    expect(message).toMatchObject({
      to: 'sales@vendor.example.in',
      replyTo: 'buyer@shakti.example.in',
      subject: en.mail.purchaseOrder.subject
        .replace('{number}', 'SS/PO/2026-27/0007')
        .replace('{company}', 'Shakti Supreme Private Limited'),
      attachments: [
        {
          fileName: 'Purchase order SS-PO-2026-27-0007.pdf',
          contentType: 'application/pdf',
          content: PDF,
        },
      ],
    });
    expect(message?.text).toContain('Sales desk');
    expect(d.tellSender).not.toHaveBeenCalled();
  });

  it('mails nothing for an order no longer sent by email, and tells nobody', async () => {
    const cancelled = deps(undefined);
    expect(await mailPurchaseOrder(job, 'req-1', cancelled.all)).toBe('not_mailable');
    expect(cancelled.readPdf).not.toHaveBeenCalled();
    expect(cancelled.mailer.sent).toHaveLength(0);
    expect(cancelled.tellSender).not.toHaveBeenCalled();
  });

  it('tells the sender once when the mail cannot go, and the order stays sent', async () => {
    const failing = deps(mailTo({ name: 'Sales desk', email: 'sales@vendor.example.in' }), {
      mailer: { send: () => Promise.reject(new Error('MessageRejected')) },
    });
    expect(await mailPurchaseOrder(job, 'req-1', failing.all)).toBe('not_sent');
    expect(failing.tellSender).toHaveBeenCalledWith(job);
    // The vendor's person lost their address since: told too, nothing mailed.
    const noAddress = deps(mailTo(null));
    expect(await mailPurchaseOrder(job, 'req-1', noAddress.all)).toBe('not_sent');
    expect(noAddress.mailer.sent).toHaveLength(0);
    expect(noAddress.tellSender).toHaveBeenCalledOnce();
    // The stored file cannot be read: told, nothing mailed.
    const noFile = deps(mailTo({ name: 'Sales desk', email: 'sales@vendor.example.in' }), {
      readPdf: () => Promise.resolve(undefined),
    });
    expect(await mailPurchaseOrder(job, 'req-1', noFile.all)).toBe('not_sent');
    expect(noFile.mailer.sent).toHaveLength(0);
    expect(noFile.tellSender).toHaveBeenCalledOnce();
  });
});
