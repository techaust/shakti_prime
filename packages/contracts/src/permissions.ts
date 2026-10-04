import { z } from 'zod';
import type { StaffRoleKey } from './roles';

/** Permission catalogue (docs/SECURITY.md §3.2). `module.resource.action`, granted with a scope. */
export const PERMISSION_KEYS = [
  'crm.lead.read',
  'crm.lead.write',
  'crm.lead.assign',
  'crm.lead.merge',
  'crm.account.read',
  'crm.account.write',
  'crm.config.write',
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
  // The file checks before an upload is usable (malware scan, re-encoding, masking): held only by
  // the platform's worker principal, never by a person's role.
  'files.process',
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
  // Pipelines, stages, dispositions and score rules shape every caller's work (design §4).
  'crm.config.write',
] as const satisfies readonly PermissionKey[];

/**
 * Permissions only the platform's own workers hold (SECURITY §3.1): no staff role may be granted
 * one. The role editor refuses them and the database refuses them for any role that is not a
 * system role (`app.platform_only_permissions()`, which a security test keeps equal to this
 * list). Plain strings, because a key joins the catalogue with the slice that first uses it.
 */
export const PLATFORM_ONLY_PERMISSIONS: readonly string[] = ['files.process'];

export function isPlatformOnlyPermission(key: string): boolean {
  return PLATFORM_ONLY_PERMISSIONS.includes(key);
}

/**
 * Grants the Executive role always keeps (SECURITY §3.1), so the group can never lock itself out
 * of managing people and roles.
 */
export const EXECUTIVE_KEPT_GRANTS = [
  { key: 'admin.roles.write', scope: 'all' },
  { key: 'admin.users.write', scope: 'all' },
] as const satisfies readonly PermissionGrant[];

/**
 * The only staff roles that may hold each cost permission (BLUEPRINT §7.2, SECURITY §3.1): the
 * role editor refuses any other role, and so does the database (`app.role_may_hold()`).
 */
export const COST_PERMISSION_HOLDERS = {
  'finance.cost.read': ['executive', 'accounts'],
  'procurement.rate.read': ['executive', 'inventory_manager', 'accounts'],
} as const satisfies Record<(typeof COST_PERMISSIONS)[number], readonly StaffRoleKey[]>;

/**
 * Permissions only the Executive role may hold (BLUEPRINT §7.1, SECURITY §3.1): every `admin.*`
 * permission and the replay of failed messages to other systems.
 */
export const EXECUTIVE_ONLY_PERMISSIONS = [
  'admin.users.write',
  'admin.roles.write',
  'admin.entities.write',
  'admin.integrations.write',
  'admin.flags.write',
  'integrations.dlq.replay',
] as const satisfies readonly PermissionKey[];

/**
 * Whether a role may hold a permission at all, whoever grants it: a platform-only permission
 * only a system role, an Executive-only permission only the Executive role, a cost permission
 * only its listed roles. `app.role_may_hold()` answers the same, which a security test compares
 * for every role and permission.
 */
export function roleMayHold(roleKey: string, permission: string): boolean {
  if (isPlatformOnlyPermission(permission)) return roleKey.startsWith('system:');
  if ((EXECUTIVE_ONLY_PERMISSIONS as readonly string[]).includes(permission)) {
    return roleKey === 'executive';
  }
  const holders = (COST_PERMISSION_HOLDERS as Record<string, readonly string[] | undefined>)[
    permission
  ];
  return holders === undefined || holders.includes(roleKey);
}

/**
 * The scopes each permission honours, the ones the role editor offers (SECURITY §3.2): the
 * scopes the permission matrix uses for it, so an `admin.*` permission is held for all companies
 * and a cost permission for a company or all of them. The seed matrix keeps to it (a test).
 */
export const PERMISSION_SCOPES: Record<PermissionKey, readonly Scope[]> = {
  'crm.lead.read': ['own', 'team', 'entity', 'all'],
  'crm.lead.write': ['own', 'team', 'entity', 'all'],
  'crm.lead.assign': ['team', 'entity', 'all'],
  'crm.lead.merge': ['team', 'entity', 'all'],
  'crm.account.read': ['own', 'team', 'entity', 'all'],
  'crm.account.write': ['own', 'team', 'entity', 'all'],
  'crm.config.write': ['all'],
  'calls.dial': ['own', 'team', 'entity', 'all'],
  'calls.recording.listen': ['team', 'entity', 'all'],
  'sales.quote.create': ['own', 'team', 'entity', 'all'],
  'sales.quote.send': ['own', 'team', 'entity', 'all'],
  'sales.order.create': ['own', 'team', 'entity', 'all'],
  'sales.order.confirm': ['own', 'team', 'entity', 'all'],
  'sales.order.cancel': ['entity', 'all'],
  'sales.credit.release': ['all'],
  'pricing.read': ['entity', 'all'],
  'pricing.write': ['all'],
  'catalogue.write': ['entity', 'all'],
  'tax.rates.write': ['entity', 'all'],
  'inventory.stock.read': ['own', 'entity', 'all'],
  'inventory.stock.move': ['own', 'entity', 'all'],
  'inventory.stock.adjust': ['entity', 'all'],
  'inventory.dispatch.write': ['entity', 'all'],
  'inventory.eway.write': ['entity', 'all'],
  'inventory.warranty.write': ['entity', 'all'],
  'procurement.po.write': ['entity', 'all'],
  'procurement.grn.write': ['entity', 'all'],
  'procurement.rate.read': ['entity', 'all'],
  'projects.read': ['own', 'entity', 'all'],
  'projects.write': ['own', 'entity', 'all'],
  'projects.gate.approve': ['entity', 'all'],
  'projects.qc.signoff': ['entity', 'all'],
  'projects.schedule.write': ['entity', 'all'],
  'documents.read': ['own', 'entity', 'all'],
  'documents.write': ['own', 'entity', 'all'],
  'documents.sensitive.read': ['entity', 'all'],
  'finance.proforma.write': ['entity', 'all'],
  'finance.payment.write': ['entity', 'all'],
  'finance.recon.write': ['entity', 'all'],
  'finance.cost.read': ['entity', 'all'],
  'finance.expense.submit': ['own'],
  'finance.expense.approve': ['team', 'entity', 'all'],
  'finance.expense.verify': ['entity', 'all'],
  'hr.employee.write': ['all'],
  'hr.attendance.manage': ['all'],
  'hr.leave.approve': ['team', 'entity', 'all'],
  'hr.incentive.manage': ['all'],
  'hr.export': ['all'],
  'knowledge.vault.read.staff': ['all'],
  'knowledge.vault.read.management': ['all'],
  'knowledge.vault.read.exec': ['all'],
  'knowledge.playbook.approve': ['all'],
  'agents.inbox.act': ['own', 'team', 'entity', 'all'],
  'agents.autonomy.write': ['all'],
  'agents.killswitch': ['all'],
  'voice.use': ['all'],
  'reports.export': ['team', 'entity', 'all'],
  'audit.read': ['entity', 'all'],
  'imports.write': ['entity', 'all'],
  'profile.write': ['own'],
  'admin.users.write': ['all'],
  'admin.roles.write': ['all'],
  'admin.entities.write': ['all'],
  'admin.integrations.write': ['all'],
  'admin.flags.write': ['all'],
  'integrations.dlq.replay': ['all'],
  // Held only by the platform's workers, for every company; the role editor never offers it.
  'files.process': ['all'],
};

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
