import { describe, expect, it } from 'vitest';
import { AGENT_ROLE_KEYS } from '../roles';
import { API_FIXTURES, IDS } from './fixtures';
import { MessageRequested } from './messaging';
import {
  AGENT_NAMES,
  MessagingSendResult,
  NotifyJob,
  OutboxEventParams,
  PdfRenderJob,
  PdfRenderResult,
} from './worker-jobs';

describe('the worker contracts (docs/06-api.md §3.6)', () => {
  it('names the agents as their principals do, without the prefix', () => {
    expect(AGENT_NAMES.map((name) => `agent:${name}`)).toEqual([...AGENT_ROLE_KEYS]);
  });

  it('routes only event types of the catalogue', () => {
    expect(OutboxEventParams.safeParse({ type: 'crm.lead.created' }).success).toBe(true);
    expect(OutboxEventParams.safeParse({ type: 'crm.lead.renamed' }).success).toBe(false);
  });

  it('answers a redelivery with the id and nothing else', () => {
    expect(PdfRenderResult.safeParse({ eventId: IDS.event, outcome: 'duplicate' }).success).toBe(
      true,
    );
    expect(
      PdfRenderResult.safeParse({ eventId: IDS.event, outcome: 'duplicate', pages: 1 }).success,
    ).toBe(false);
    expect(PdfRenderResult.safeParse({ eventId: IDS.event, outcome: 'done' }).success).toBe(false);
  });

  it('keeps names and text out of a job body', () => {
    const notify = API_FIXTURES['workers.notify'].request as Record<string, unknown>;
    expect(NotifyJob.safeParse(notify).success).toBe(true);
    expect(NotifyJob.safeParse({ ...notify, title: 'Lead from Bikaner' }).success).toBe(false);
    expect(
      NotifyJob.safeParse({ ...notify, subject: { type: 'opportunity', id: 'Ramesh' } }).success,
    ).toBe(false);
  });

  it('renders a document version or a sheet of 1 to 500 labels', () => {
    const labels = (ids: string[]) =>
      PdfRenderJob.safeParse({
        eventId: IDS.eventB,
        entityId: 1,
        target: { kind: 'labels', labelKind: 'serial', size: '50x25', ids },
      }).success;
    expect(labels([IDS.serialA, IDS.serialB])).toBe(true);
    expect(labels([])).toBe(false);
    expect(labels(Array.from({ length: 501 }, () => IDS.serialA))).toBe(false);
  });

  it('reports a refused message with its reason and no provider id', () => {
    const refused = { eventId: IDS.eventB, outcome: 'done', status: 'refused' };
    expect(MessagingSendResult.safeParse({ ...refused, refusal: 'window_closed' }).success).toBe(
      true,
    );
    expect(
      MessagingSendResult.safeParse({
        ...refused,
        refusal: 'window_closed',
        providerMessageId: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('message.requested (docs/06-api.md §6)', () => {
  it('sends a template by its approved name with its parameters', () => {
    const parsed = MessageRequested.parse({
      threadId: IDS.thread,
      kind: 'template',
      templateName: 'payment_due',
    });
    expect(parsed).toEqual({
      threadId: IDS.thread,
      kind: 'template',
      templateName: 'payment_due',
      params: [],
    });
    expect(
      MessageRequested.safeParse({
        threadId: IDS.thread,
        kind: 'template',
        templateName: 'Pay Now',
      }).success,
    ).toBe(false);
  });

  it('sends a session message only as a masked body', () => {
    expect(
      MessageRequested.safeParse({
        threadId: IDS.thread,
        kind: 'session',
        bodyMasked: 'Your engineer visits on 28-09-2026.',
      }).success,
    ).toBe(true);
    expect(MessageRequested.safeParse({ threadId: IDS.thread, kind: 'session' }).success).toBe(
      false,
    );
    expect(
      MessageRequested.safeParse({
        threadId: IDS.thread,
        kind: 'session',
        bodyMasked: 'Your engineer visits tomorrow.',
        templateName: 'visit_booked',
      }).success,
    ).toBe(false);
  });
});
