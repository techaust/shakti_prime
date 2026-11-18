import { describe, expect, it } from 'vitest';
import { AGENT_ROLE_KEYS } from '../roles';
import { API_FIXTURES, IDS } from './fixtures';
import { MessageRequested } from './messaging';
import {
  AGENT_NAMES,
  MessagingSendJob,
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
    expect(NotifyJob.safeParse({ ...notify, aggregateId: 'Ramesh' }).success).toBe(false);
    const payload = notify.payload as Record<string, unknown>;
    expect(
      NotifyJob.safeParse({ ...notify, payload: { ...payload, name: 'Ramesh' } }).success,
    ).toBe(false);
    expect(NotifyJob.safeParse({ ...notify, type: 'crm.lead.created' }).success).toBe(false);
    // A held dealer order notifies too (SAL-07), with the ids and the rule's code only.
    const held = {
      ...notify,
      type: 'sales.order.credit_held',
      payload: { accountId: IDS.event, createdBy: IDS.event, reason: 'credit_overdue', v: 1 },
    };
    expect(NotifyJob.safeParse(held).success).toBe(true);
    expect(
      NotifyJob.safeParse({ ...held, payload: { ...held.payload, reason: 'Ramesh owes' } }).success,
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

describe('messaging.message.requested (docs/06-api.md §6)', () => {
  it('carries the queued message by its ids and kind, never its text', () => {
    const event = { messageId: IDS.event, threadId: IDS.thread, kind: 'template' };
    expect(MessageRequested.safeParse(event).success).toBe(true);
    expect(MessageRequested.safeParse({ ...event, kind: 'session' }).success).toBe(false);
    expect(
      MessageRequested.safeParse({ ...event, bodyMasked: 'Your engineer visits tomorrow.' })
        .success,
    ).toBe(false);
    expect(
      MessagingSendJob.safeParse({ eventId: IDS.eventB, entityId: 1, messageId: IDS.event })
        .success,
    ).toBe(true);
    expect(
      MessagingSendJob.safeParse({
        eventId: IDS.eventB,
        entityId: 1,
        messageId: IDS.event,
        templateName: 'quote_sent',
      }).success,
    ).toBe(false);
  });

  it('answers a held, failed or skipped message with no provider id or reason', () => {
    for (const status of ['held', 'failed', 'skipped']) {
      expect(
        MessagingSendResult.safeParse({ eventId: IDS.eventB, outcome: 'done', status }).success,
      ).toBe(true);
      expect(
        MessagingSendResult.safeParse({
          eventId: IDS.eventB,
          outcome: 'done',
          status,
          refusal: 'opted_out',
        }).success,
      ).toBe(false);
    }
  });
});
