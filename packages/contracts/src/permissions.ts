import { z } from 'zod';

/** Permission catalogue (docs/SECURITY.md §3.2). `module.resource.action`, granted with a scope. */
export const PERMISSION_KEYS = [
  'crm.lead.read',
  'crm.lead.write',
  'crm.lead.assign',
  'crm.lead.merge',
  'crm.account.read',
  'crm.account.write',
  'calls.dial',
  'calls.recording.listen',
  'sales.quote.create',
  'sales.quote.send',
  'sales.order.create',
  'sales.order.confirm',
  'sales.order.cancel',
  'sales.credit.release',
  'pricing.read',
  'pricing.write',
  'catalogue.write',
  'tax.rates.write',
  'inventory.stock.read',
  'inventory.stock.move',
  'inventory.stock.adjust',
  'inventory.dispatch.write',
  'inventory.eway.write',
  'inventory.warranty.write',
  'procurement.po.write',
  'procurement.grn.write',
  'procurement.rate.read',
  'projects.read',
  'projects.write',
  'projects.gate.approve',
  'projects.qc.signoff',
  'projects.schedule.write',
  'documents.read',
  'documents.write',
  'documents.sensitive.read',
  'finance.proforma.write',
  'finance.payment.write',
  'finance.recon.write',
  'finance.cost.read',
  'finance.expense.submit',
  'finance.expense.approve',
  'finance.expense.verify',
  'hr.employee.write',
  'hr.attendance.manage',
  'hr.leave.approve',
  'hr.incentive.manage',
  'hr.export',
  'knowledge.vault.read.staff',
  'knowledge.vault.read.management',
  'knowledge.vault.read.exec',
  'knowledge.playbook.approve',
  'agents.inbox.act',
  'agents.autonomy.write',
  'agents.killswitch',
  'voice.use',
  'reports.export',
  'audit.read',
  'imports.write',
  'profile.write',
  'admin.users.write',
  'admin.roles.write',
  'admin.entities.write',
  'admin.integrations.write',
  'admin.flags.write',
  'integrations.dlq.replay',
] as const;

export const PermissionKeySchema = z.enum(PERMISSION_KEYS);
export type PermissionKey = z.infer<typeof PermissionKeySchema>;

/** Scopes from narrowest to widest. A grant at one scope implies every narrower scope. */
export const SCOPES = ['own', 'team', 'entity', 'all'] as const;
export const ScopeSchema = z.enum(SCOPES);
export type Scope = z.infer<typeof ScopeSchema>;

export const PermissionGrantSchema = z.object({
  key: PermissionKeySchema,
  scope: ScopeSchema,
});
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>;

/** The two cost permissions (CLAUDE.md, SECURITY §4). No agent principal ever holds either. */
export const COST_PERMISSIONS = [
  'finance.cost.read',
  'procurement.rate.read',
] as const satisfies readonly PermissionKey[];

/** Permissions no agent principal may hold (SECURITY §3.3). */
export const AGENT_FORBIDDEN_PERMISSIONS = [
  ...COST_PERMISSIONS,
  'documents.sensitive.read',
  'knowledge.vault.read.exec',
  'admin.users.write',
  'admin.roles.write',
  'admin.entities.write',
  'admin.integrations.write',
  'admin.flags.write',
  // Human approval and control of the agents themselves (AUDIT M13): an agent never approves its
  // own "Needs approval" actions, changes autonomy, stops agents, or releases credit.
  'agents.inbox.act',
  'agents.autonomy.write',
  'agents.killswitch',
  'knowledge.playbook.approve',
  'sales.credit.release',
  // The second approval of an expense claim is a person's check (FIN-07), and replaying a dead
  // letter re-sends a message outside the agent's own work.
  'finance.expense.verify',
  'integrations.dlq.replay',
] as const satisfies readonly PermissionKey[];

export function permissionModule(key: PermissionKey): string {
  return key.split('.')[0] ?? key;
}

/** Scopes implied by a grant: `all` implies `entity`, `team` and `own`. */
export function impliedScopes(scope: Scope): Scope[] {
  return SCOPES.slice(0, SCOPES.indexOf(scope) + 1);
}

/**
 * Serialises grants for the `app.permissions` transaction setting read by `app.has_perm()`:
 * `key:scope` pairs, comma separated, with implied scopes expanded so a policy that checks
 * `finance.cost.read:entity` also passes for a holder of `finance.cost.read:all`.
 */
export function serializeGrants(grants: readonly PermissionGrant[]): string {
  const pairs = new Set<string>();
  for (const grant of grants) {
    for (const scope of impliedScopes(grant.scope)) pairs.add(`${grant.key}:${scope}`);
  }
  return [...pairs].sort().join(',');
}

/** True when the grants satisfy `key` at `scope` or wider. */
export function hasGrant(
  grants: readonly PermissionGrant[],
  key: PermissionKey,
  scope: Scope,
): boolean {
  return grants.some((g) => g.key === key && impliedScopes(g.scope).includes(scope));
}
