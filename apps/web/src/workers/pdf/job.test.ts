import { newId, PdfRenderJob, type DeliveredEvent } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { LABELS_EVENT, labelsJobOf, RENDER_EVENT, renderEventOf, renderJobOf } from './job';

function requested(): DeliveredEvent {
  return {
    id: newId(),
    sequence: '42',
    type: RENDER_EVENT,
    entityId: 2,
    aggregateType: 'print_proof',
    aggregateId: newId(),
    payload: {
      documentType: 'company_letterhead_proof',
      documentId: newId(),
      version: 1,
      v: 1,
    },
  };
}

describe('a render job and its event', () => {
  it('carries the event id as its key, the company and the document, nothing more', () => {
    const event = requested();
    const job = renderJobOf(event);
    expect(job).toEqual({
      eventId: event.id,
      entityId: 2,
      target: {
        kind: 'document',
        documentType: 'company_letterhead_proof',
        documentId: event.payload.documentId,
        version: 1,
      },
    });
    expect(PdfRenderJob.safeParse(job).success).toBe(true);
  });

  it('stands for the same event id, company and document again', () => {
    const event = requested();
    const back = renderEventOf(renderJobOf(event));
    expect(back).toMatchObject({
      id: event.id,
      type: RENDER_EVENT,
      entityId: 2,
      aggregateId: event.payload.documentId,
      payload: event.payload,
    });
    expect(renderJobOf(back)).toEqual(renderJobOf(event));
  });

  it('refuses a payload that is not a document', () => {
    expect(() => renderJobOf({ ...requested(), payload: { v: 1 } })).toThrow();
  });
});

describe('a sheet of labels and its event (Q1)', () => {
  function sheet(): DeliveredEvent {
    const sheetId = newId();
    return {
      id: newId(),
      sequence: '43',
      type: LABELS_EVENT,
      entityId: 1,
      aggregateType: 'label_sheet',
      aggregateId: sheetId,
      payload: { sheetId, labelKind: 'bin', size: '50x25', ids: [newId(), newId()], v: 1 },
    };
  }

  it('carries the sheet, its kind, size and ids in order, and stands for the same event again', () => {
    const event = sheet();
    const job = labelsJobOf(event);
    expect(job).toEqual({
      eventId: event.id,
      entityId: 1,
      target: {
        kind: 'labels',
        sheetId: event.payload.sheetId,
        labelKind: 'bin',
        size: '50x25',
        ids: event.payload.ids,
      },
    });
    const back = renderEventOf(job);
    expect(back).toMatchObject({
      id: event.id,
      type: LABELS_EVENT,
      entityId: 1,
      aggregateType: 'label_sheet',
      aggregateId: event.payload.sheetId,
      payload: event.payload,
    });
    expect(labelsJobOf(back)).toEqual(job);
  });

  it('refuses a sheet with no ids, and a package sheet until dispatch adds packages', () => {
    expect(() => labelsJobOf({ ...sheet(), payload: { ...sheet().payload, ids: [] } })).toThrow();
    expect(() =>
      renderEventOf({
        eventId: newId(),
        entityId: 1,
        target: {
          kind: 'labels',
          sheetId: newId(),
          labelKind: 'package',
          size: '100x50',
          ids: [newId()],
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'not_found' }));
  });
});
