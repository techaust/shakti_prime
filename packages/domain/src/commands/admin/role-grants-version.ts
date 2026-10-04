import { createHash } from 'node:crypto';

/**
 * The fingerprint of a role's grant set: SHA-256 of its `permission:scope` pairs in order. The
 * role editor sends back the one it read, and `admin.role.permissions.set` refuses the save when
 * the set has changed since (`role_changed_meanwhile`).
 */
export function roleGrantsVersion(
  grants: readonly { permission: string; scope: string }[],
): string {
  const lines = grants.map((g) => `${g.permission}:${g.scope}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}
