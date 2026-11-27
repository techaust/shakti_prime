import {
  EVENT_VERSION,
  newId,
  type DeliveredEvent,
  type Principal,
  type PurchaseOrderWithRatesDto,
} from '@shakti/contracts';
import { memoryMailer, type Logger, type PurchaseOrderMail } from '@shakti/domain';
import { describe, expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import { handlePurchaseOrderSent, type PurchaseOrderMailDeps } from './procurement-mail';

const ORDER = newId();
const CONTACT = newId();
const SENDER = newId();
const quiet: Logger = { log: () => undefined };
const principal = { id: newId() } as Principal;

function sent(via: 'email' | 'by_hand'): DeliveredEvent {
  return {
    id: newId(),
    sequence: '7',
    type: 'procurement.po.sent',
    entityId: 1,
    aggregateType: 'purchase_order',
    aggregateId: ORDER,
    payload: {
      v: EVENT_VERSION,
      vendorId: newId(),
      via,
      vendorContactId: via === 'email' ? CONTACT : null,
      sentBy: SENDER,
    },
  };
}

function mailOf(to: PurchaseOrderMail['to']): PurchaseOrderMail {
  const order = { poNo: 'SS/PO/2026-27/0007', entityId: 1 } as PurchaseOrderWithRatesDto;
  return {
    print: {
      order,
      company: {
        legalName: 'Shakti Supreme Private Limited',
        brandName: 'Shakti Supreme',
        addressLines: [],
        gstin: null,
      },
      vendor: { name: 'Mewar Cables', gstin: null, addressLines: [] },
    },
    to,
    replyTo: 'buyer@shakti.example.in',
  };
}

function deps(read: PurchaseOrderMail | undefined, overrides: Partial<PurchaseOrderMailDeps> = {}) {
  const mailer = memoryMailer();
  const tellSender = vi.fn<PurchaseOrderMailDeps['tellSender']>().mockResolvedValue(undefined);
  const readFn = vi.fn<PurchaseOrderMailDeps['read']>().mockResolvedValue(read);
  const all: PurchaseOrderMailDeps = {
    read: readFn,
    mailer,
    pdf: () => Promise.resolve(new Uint8Array([37, 80, 68, 70])),
    tellSender,
    logger: quiet,
    ...overrides,
  };
  return { all, mailer, tellSender, readFn };
}

const ctx = { principal, requestId: 'req-1' };

describe('the purchase order mailer (review finding 4)', () => {
  it('mails the vendor’s person the PDF, with the sender’s address to reply to', async () => {
    const d = deps(mailOf({ name: 'Sales desk', email: 'sales@vendor.example.in' }));
    expect(await handlePurchaseOrderSent(sent('email'), ctx, d.all)).toBe('mailed');
    expect(d.readFn).toHaveBeenCalledWith({
      entityId: 1,
      purchaseOrderId: ORDER,
      vendorContactId: CONTACT,
      sentBy: SENDER,
    });
    expect(d.mailer.sent).toHaveLength(1);
    const [message] = d.mailer.sent;
    expect(message).toMatchObject({
      to: 'sales@vendor.example.in',
      replyTo: 'buyer@shakti.example.in',
      subject: en.mail.purchaseOrder.subject
        .replace('{number}', 'SS/PO/2026-27/0007')
        .replace('{company}', 'Shakti Supreme Private Limited'),
      attachments: [
        { fileName: 'Purchase order SS-PO-2026-27-0007.pdf', contentType: 'application/pdf' },
      ],
    });
    expect(message?.text).toContain('Sales desk');
    expect(d.tellSender).not.toHaveBeenCalled();
  });

  it('leaves an order sent by hand alone, and mails nothing for one no longer sent by email', async () => {
    const byHand = deps(mailOf({ name: 'x', email: 'x@vendor.example.in' }));
    expect(await handlePurchaseOrderSent(sent('by_hand'), ctx, byHand.all)).toBe('by_hand');
    expect(byHand.readFn).not.toHaveBeenCalled();
    const cancelled = deps(undefined);
    expect(await handlePurchaseOrderSent(sent('email'), ctx, cancelled.all)).toBe('not_mailable');
    expect(cancelled.mailer.sent).toHaveLength(0);
    expect(cancelled.tellSender).not.toHaveBeenCalled();
  });

  it('tells the sender once when the mail cannot go, and the order stays sent', async () => {
    const event = sent('email');
    const failing = deps(mailOf({ name: 'Sales desk', email: 'sales@vendor.example.in' }), {
      mailer: { send: () => Promise.reject(new Error('MessageRejected')) },
    });
    expect(await handlePurchaseOrderSent(event, ctx, failing.all)).toBe('not_sent');
    expect(failing.tellSender).toHaveBeenCalledWith({
      entityId: 1,
      eventId: event.id,
      purchaseOrderId: ORDER,
      sentBy: SENDER,
    });
    // The vendor's person lost their address since: told too, nothing mailed.
    const noAddress = deps(mailOf(null));
    expect(await handlePurchaseOrderSent(event, ctx, noAddress.all)).toBe('not_sent');
    expect(noAddress.mailer.sent).toHaveLength(0);
    expect(noAddress.tellSender).toHaveBeenCalledOnce();
  });
});
