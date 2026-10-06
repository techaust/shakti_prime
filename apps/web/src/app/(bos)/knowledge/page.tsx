import { KNOWLEDGE_READ_PERMISSION, type KnowledgeSensitivity } from '@shakti/contracts';
import { UPLOAD_LIMITS } from '@shakti/domain';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listKnowledgeFiles } from '../../../actions/knowledge';
import { KnowledgeScreen } from '../../../components/knowledge/knowledge-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { KNOWLEDGE_SENSITIVITY_VALUES } from '../../../screens/contract-values';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('knowledge'), (await getTranslations('knowledge'))('title'));
}

/** A vault upload's limits, for the uploader to check before it sends a byte. */
function vaultLimit() {
  const found = UPLOAD_LIMITS.knowledge;
  if (found === undefined) throw new Error('no upload limits for the vault');
  return { contentTypes: [...found.contentTypes], maxBytes: found.maxBytes };
}

/**
 * Knowledge (docs/design/phase1.md §8.4, PRD AI-01): the staff search and the vault files the
 * caller may read; an Executive or GM adds, reads again and archives files.
 */
export default async function KnowledgePage() {
  const { principal, access, activeEntityId, can } = await screenAccess(navRequires('knowledge'));
  const t = await getTranslations('knowledge');
  const canWrite = can('knowledge.vault.write', 'all');
  // The sensitivities a writer may give a file: those they may read themselves.
  const sensitivities = KNOWLEDGE_SENSITIVITY_VALUES.filter((s: KnowledgeSensitivity) =>
    can(KNOWLEDGE_READ_PERMISSION[s], 'all'),
  );
  const names = companyNames(access);
  const companies = principal.entityIds.map((id) => ({ id, name: names[id] ?? String(id) }));
  const page = await listKnowledgeFiles({});
  return (
    <Page title={t('title')} description={t('intro')} width="detail">
      {page.ok ? (
        <KnowledgeScreen
          initial={page.data}
          companies={companies}
          allCompanies={activeEntityId === undefined}
          {...(canWrite ? { writer: { sensitivities, limit: vaultLimit() } } : {})}
        />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
