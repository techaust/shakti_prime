import { DeliveryProbeDto, DomainError, newId, RunDeliveryProbeInput } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';

/**
 * `platform.probe.run` (docs/03-roadmap-appendix/phase1.md §5.2): the delivery check on Integration Health.
 * An Executive asks; the command emits `platform.probe.requested`, whose worker records when it
 * arrived, and the page shows the time from here to the worker, the measure the handover's
 * ten-second target rests on. The probe belongs to no company and changes no row, so its event is
 * filed under the request's first company and its audit row under none.
 */
export const runDeliveryProbe = defineCommand({
  name: 'platform.probe.run',
  permission: 'admin.integrations.write',
  minScope: 'all',
  input: RunDeliveryProbeInput,
  output: DeliveryProbeDto,
  auditFields: ['requestedAt'],
  handler(ctx) {
    const entityId = ctx.activeEntityId ?? Math.min(...ctx.entityIds);
    if (!Number.isInteger(entityId)) {
      throw new DomainError('forbidden', 'the delivery check needs a company in scope');
    }
    const probeId = newId();
    const requestedAt = ctx.now.toISOString();
    ctx.emit({
      type: 'platform.probe.requested',
      entityId,
      aggregateType: 'delivery_probe',
      aggregateId: probeId,
      payload: { requestedAt },
    });
    ctx.audit({
      aggregateType: 'delivery_probe',
      aggregateId: probeId,
      entityId: null,
      after: { requestedAt },
    });
    return Promise.resolve({ probeId, requestedAt });
  },
});
