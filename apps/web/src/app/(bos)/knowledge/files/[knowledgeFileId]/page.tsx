import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { openFile } from '../../../../../actions/files';
import { getKnowledgeFile } from '../../../../../actions/knowledge';
import { KnowledgeFileScreen } from '../../../../../components/knowledge/knowledge-file-screen';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../../screens/access';
import { firstFailure } from '../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('knowledge'), (await getTranslations('knowledge'))('file.title'));
}

/**
 * One Knowledge Vault file (docs/03-roadmap-appendix/phase2.md §6.4): where it stands, and for a
 * recording (K3) its player, through the short-lived address the file checks' store signs, beside
 * its transcript, which a holder of `knowledge.vault.write` corrects. A file the caller may not
 * read, or an address that names none, shows the not-found screen.
 */
export default async function KnowledgeFilePage({
  params,
}: {
  params: Promise<{ knowledgeFileId: string }>;
}) {
  const { principal, access, can } = await screenAccess(navRequires('knowledge'));
  const { knowledgeFileId } = await params;
  if (!UUID.test(knowledgeFileId)) notFound();
  const t = await getTranslations('knowledge');
  const file = await getKnowledgeFile(knowledgeFileId);
  if (!file.ok && ['knowledge_file_missing', 'forbidden'].includes(file.error)) notFound();
  const back = (
    <Button asChild variant="secondary">
      <Link href="/knowledge">{t('file.back')}</Link>
    </Button>
  );
  if (!file.ok) {
    return (
      <Page title={t('file.title')} width="detail" actions={back}>
        <FailureMessage failure={firstFailure(file)} />
      </Page>
    );
  }
  const vault = file.data;
  // A recording is played from its checked upload; one the store cannot sign shows a sentence.
  const played = vault.sourceType === 'audio' ? await openFile(vault.fileId) : undefined;
  const names = companyNames(access);
  return (
    <Page title={vault.title} width="detail" actions={back}>
      <KnowledgeFileScreen
        initial={vault}
        company={vault.entityId === null ? undefined : (names[vault.entityId] ?? undefined)}
        // A file of the whole group is changed in a request for every company (ADR 0016).
        entityId={vault.entityId ?? principal.entityIds[0] ?? 0}
        canCorrect={can('knowledge.vault.write', 'all')}
        {...(played?.ok === true ? { audioUrl: played.data.url } : {})}
      />
    </Page>
  );
}
