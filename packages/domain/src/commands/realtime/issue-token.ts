import {
  DomainError,
  IssueRealtimeTokenInput,
  isAgentRole,
  newId,
  RealtimeTokenGrant,
} from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';

/**
 * `realtime.token.issue` (docs/design/backend-weeks-3-5.md §2.6, ADR 0003): settles the claims of
 * a Realtime token for the signed-in person and the companies active for the request, and records
 * one audit row with the token's id, so every token that opens a channel can be traced to who
 * received it and when. The route signs the claims; the token never reaches this command.
 *
 * Every staff role holds `profile.write` at `own` and no agent holds it: the token is the
 * caller's own, like their theme. A voice session or agent is refused even so.
 */
export const issueRealtimeToken = defineCommand({
  name: 'realtime.token.issue',
  permission: 'profile.write',
  minScope: 'own',
  input: IssueRealtimeTokenInput,
  output: RealtimeTokenGrant,
  auditFields: ['bosRole'],
  handler(ctx) {
    const { principal } = ctx;
    if (principal.kind !== 'user' || isAgentRole(principal.roleKey)) {
      throw new DomainError('forbidden', 'only a signed-in person receives a Realtime token');
    }
    const entityIds = [...new Set(ctx.entityIds)].sort((a, b) => a - b);
    if (entityIds.length === 0) {
      throw new DomainError('forbidden', 'a Realtime token needs at least one entity in scope');
    }
    const grant = {
      jti: newId(),
      sub: principal.id,
      bos_role: principal.roleKey,
      entity_ids: entityIds,
    };
    ctx.audit({
      aggregateType: 'realtime_token',
      aggregateId: grant.jti,
      entityId: null,
      after: { entityIds, bosRole: principal.roleKey },
    });
    return Promise.resolve(grant);
  },
});
