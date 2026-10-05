import type { PermissionGrant } from './permissions';
import type { SystemRoleKey } from './roles';

/** The seeded principal row of the event workers (`principals.kind = system`). */
export const SYSTEM_WORKERS_PRINCIPAL_ID = '01990000-0000-7000-8000-000000000501';

/**
 * What each system role holds (docs/SECURITY.md §3.3): only what its jobs need, and never a cost,
 * admin, audit, integrations or sensitive-document permission (the agent refusal sweep checks it).
 * The seed writes these rows and the workers build their principal from the same list, so the two
 * cannot differ. The delivery check's handler writes nothing to the database; the file checks
 * (`files.file.uploaded`) move a file through them with `files.file.*`, which need `files.process`
 * and nothing else. Each slice that gives the workers a command adds its grant here and in
 * SECURITY §3.3.
 *
 * The workers hold no `crm.*` permission a person may hold: until the owner decides at T2 they
 * follow an agent's customer rules (ADR 0020), and the rules of C2 that test agents only rely on
 * it.
 */
export const SYSTEM_MATRIX: Record<SystemRoleKey, readonly PermissionGrant[]> = {
  'system:workers': [
    { key: 'files.process', scope: 'all' },
    // The nightly rescoring (`crm.lead.score_refresh`): it reads each open lead's scoring facts and
    // writes its score through two definers, nothing more.
    { key: 'crm.score.refresh', scope: 'all' },
    // The daily quote expiry (`sales.quote.expire`): it reads the company's lapsed quotes and
    // marks them expired through two definers, nothing more.
    { key: 'sales.quote.expire', scope: 'all' },
  ],
};
