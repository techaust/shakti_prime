// The companies an HR screen offers, worked out on the server from the person's request
// (docs/03-roadmap-appendix/phase5.md §5). Hiding a choice is a courtesy: every command checks
// the company again, and a group setting needs a request covering every company.

import type { Principal } from '@shakti/contracts';
import type { UserAccess } from '@shakti/domain';

export interface HrCompany {
  id: number | null;
  name: string;
}

/** The companies of the request, by name, as `{ id, name }`. */
export function requestCompanies(
  principal: Pick<Principal, 'entityIds'>,
  access: UserAccess,
): HrCompany[] {
  return access.entities
    .filter((e) => principal.entityIds.includes(e.entityId))
    .map((e) => ({ id: e.entityId, name: e.entityName }));
}

/** Where a setting may belong: the whole group first when the request covers it, then each company. */
export function settingCompanies(
  principal: Pick<Principal, 'entityIds'>,
  access: UserAccess,
  coversGroup: boolean,
  groupName: string,
): HrCompany[] {
  return [
    ...(coversGroup ? [{ id: null, name: groupName }] : []),
    ...requestCompanies(principal, access),
  ];
}
