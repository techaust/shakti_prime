import { COST_PERMISSIONS, type PermissionKey, type Principal } from '@shakti/contracts';

/**
 * The principal of a "Talk to Shakti" session (docs/07-security.md §3.4, ADR 0010): the speaking
 * person, as their own principal resolves them now, acting through the session. It keeps the
 * person's id, role, grants and teams, so every command and read runs under their own grants and
 * row security, and it is of kind `voice_session` with the session named, so the guard refuses it
 * every command for people only and the audit trail names the session with the person beside it.
 *
 * It never carries a cost permission (`finance.cost.read`, `procurement.rate.read`), even for an
 * Executive: a spoken answer never reads out a cost or a supplier's rate, which stay on the screen
 * reports run under the viewer's own grants. Its companies are the session's, never wider than
 * the person's own; a session covering a company the person no longer holds yields no principal.
 */
export function voiceSessionPrincipal(
  person: Principal,
  voiceSessionId: string,
  sessionEntityIds: readonly number[],
): Principal | undefined {
  if (person.kind !== 'user') return undefined;
  const entityIds = [...new Set(sessionEntityIds)].sort((a, b) => a - b);
  if (entityIds.length === 0 || entityIds.some((e) => !person.entityIds.includes(e))) {
    return undefined;
  }
  const costs: readonly PermissionKey[] = COST_PERMISSIONS;
  const entityTeams = person.entityTeams?.filter((t) => entityIds.includes(t.entityId));
  const only = entityIds.length === 1 ? entityIds[0] : undefined;
  const teamId =
    only === undefined
      ? undefined
      : (entityTeams?.find((t) => t.entityId === only)?.teamId ?? person.teamId);
  const rest: Principal = { ...person };
  delete rest.teamId;
  delete rest.entityTeams;
  return {
    ...rest,
    kind: 'voice_session',
    voiceSessionId,
    entityIds,
    permissions: person.permissions.filter((g) => !costs.includes(g.key)),
    ...(teamId === undefined ? {} : { teamId }),
    ...(entityTeams === undefined ? {} : { entityTeams }),
  };
}
