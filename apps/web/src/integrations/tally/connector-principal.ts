import { SYSTEM_MATRIX, type Principal } from '@shakti/contracts';

/**
 * A Tally connector's principal (`connector:tally:<id>`, docs/03-roadmap-appendix/phase5.md §4):
 * its own `principals` row, made when an Executive registered it, acting in the role
 * `system:tally_connector`, which holds only `tally.connector.sync`: its routes, and no table. Its
 * companies are those mapped to it, and each call narrows the request to the one company the
 * call names; with none it may only ask for its own keys and send its heartbeat.
 */
export function tallyConnectorPrincipal(
  connectorId: string,
  entityIds: readonly number[],
): Principal {
  return {
    id: connectorId,
    kind: 'system',
    roleKey: 'system:tally_connector',
    entityIds: [...entityIds],
    permissions: [...SYSTEM_MATRIX['system:tally_connector']],
  };
}
