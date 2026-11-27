import {
  DomainError,
  EVENT_VERSION,
  PdfRenderJob,
  PO_PDF_AS_APPROVED,
  type DeliveredEvent,
} from '@shakti/contracts';

/*
 * A render job and the outbox event it comes from (ADR 0009, docs/06-api.md §3.6), each made from the
 * other. Kept apart from the renderer, so the publisher and the routes that only route a job never
 * load Chromium's driver.
 */

/** The event a document's render job comes from. */
export const RENDER_EVENT = 'print.document.requested';

/** The event a sheet of labels comes from (Q1). */
export const LABELS_EVENT = 'print.labels.requested';

/**
 * The job the outbox sends for a `print.document.requested` event: the event's id is the job's
 * idempotency key, its company the selling company, its payload the document.
 */
export function renderJobOf(event: DeliveredEvent): PdfRenderJob {
  const { documentType, documentId, version } = event.payload;
  return PdfRenderJob.parse({
    eventId: event.id,
    entityId: event.entityId,
    target: { kind: 'document', documentType, documentId, version },
  });
}

/**
 * The job the outbox sends for a `print.labels.requested` event (Q1): the sheet's company, its
 * kind, the stock size and the ids, in order.
 */
export function labelsJobOf(event: DeliveredEvent): PdfRenderJob {
  const { sheetId, labelKind, size, ids } = event.payload;
  return PdfRenderJob.parse({
    eventId: event.id,
    entityId: event.entityId,
    target: { kind: 'labels', sheetId, labelKind, size, ids },
  });
}

/** The event a purchase order's sending comes from (U2). */
export const PO_SENT_EVENT = 'procurement.po.sent';

/**
 * The job the outbox sends for a `procurement.po.sent` event (U2, review R2): sent by email, the
 * order's PDF as approved is printed (or found stored) and mailed to the vendor's person named;
 * marked sent by hand, it is only printed (or found stored), ready to download.
 */
export function purchaseOrderSentJobOf(event: DeliveredEvent): PdfRenderJob {
  const { via, vendorContactId, sentBy } = event.payload;
  const target =
    via === 'email' && typeof vendorContactId === 'string'
      ? {
          kind: 'purchase_order_mail',
          purchaseOrderId: event.aggregateId,
          vendorContactId,
          sentBy,
        }
      : {
          kind: 'document',
          documentType: 'purchase_order',
          documentId: event.aggregateId,
          version: PO_PDF_AS_APPROVED,
        };
  return PdfRenderJob.parse({ eventId: event.id, entityId: event.entityId, target });
}

/**
 * The event a job stands for, so the render route claims and records the job's id exactly as an
 * event worker does (`deliverEvent`), which reads only its id, type and company here.
 */
export function renderEventOf(job: PdfRenderJob): DeliveredEvent {
  if (job.target.kind === 'purchase_order_mail') {
    const { purchaseOrderId, vendorContactId, sentBy } = job.target;
    return {
      id: job.eventId,
      sequence: '0',
      type: PO_SENT_EVENT,
      entityId: job.entityId,
      aggregateType: 'purchase_order',
      aggregateId: purchaseOrderId,
      payload: { via: 'email', vendorContactId, sentBy, v: EVENT_VERSION },
    };
  }
  if (job.target.kind === 'labels') {
    const { sheetId, labelKind, size, ids } = job.target;
    if (labelKind === 'package') {
      throw new DomainError('not_found', 'package labels are printed once dispatch adds them', {
        reason: 'document_type_unknown',
      });
    }
    return {
      id: job.eventId,
      sequence: '0',
      type: LABELS_EVENT,
      entityId: job.entityId,
      aggregateType: 'label_sheet',
      aggregateId: sheetId,
      payload: { sheetId, labelKind, size, ids, v: EVENT_VERSION },
    };
  }
  const { documentType, documentId, version } = job.target;
  return {
    id: job.eventId,
    sequence: '0',
    type: RENDER_EVENT,
    entityId: job.entityId,
    aggregateType: documentType,
    aggregateId: documentId,
    payload: { documentType, documentId, version, v: EVENT_VERSION },
  };
}
