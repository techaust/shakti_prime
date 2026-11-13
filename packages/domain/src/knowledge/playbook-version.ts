import { newId } from '@shakti/contracts';
import type { KeyValue } from '../ports/key-value';

// The Playbook's version (docs/03-roadmap-appendix/phase2.md §5.4): every change of a directive
// (`knowledge.playbook.changed`) writes a new version id, and an agent or Ask that keeps the
// approved directives between runs reads them again when the id it holds differs. A new id each
// time, never a counter, so a key that expired and came back can never repeat an old value.

/** The Redis key that holds the Playbook's current version id. */
export const PLAYBOOK_VERSION_KEY = 'knowledge:playbook:version';

/** How long a version id is kept: a year, renewed by every change. */
export const PLAYBOOK_VERSION_TTL_SECONDS = 365 * 24 * 60 * 60;

/** Writes a new version id and answers it. */
export async function bumpPlaybookVersion(keyValue: KeyValue): Promise<string> {
  const version = newId();
  await keyValue.set(PLAYBOOK_VERSION_KEY, version, PLAYBOOK_VERSION_TTL_SECONDS);
  return version;
}

/** The current version id, or null when none is stored (read the directives afresh). */
export function playbookVersion(keyValue: KeyValue): Promise<string | null> {
  return keyValue.get(PLAYBOOK_VERSION_KEY);
}
