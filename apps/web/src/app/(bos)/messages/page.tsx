import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listWaitingThreads, loadThread } from '../../../actions/messaging';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { companyParam } from '../../../screens/customers';
import { MessagesScreen } from '../../../screens/messaging/messages-screen';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('messages'), (await getTranslations('messaging'))('title'));
}

/**
 * Messages (docs/03-roadmap-appendix/phase2.md §6.1): the WhatsApp chats waiting for a reply that
 * the person may answer, and one chat beside them; a notice of a waiting chat opens it here.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { access } = await screenAccess(navRequires('messages'));
  const query = await searchParams;
  const t = await getTranslations('messaging');
  const page = await listWaitingThreads({});
  const raw = Array.isArray(query.thread) ? query.thread[0] : query.thread;
  const entityId = companyParam(query.company);
  const asked =
    raw !== undefined && UUID.test(raw) && entityId !== undefined
      ? await loadThread({ entityId, threadId: raw })
      : undefined;
  return (
    <Page title={t('title')} description={t('intro')} width="full">
      {page.ok ? (
        <MessagesScreen
          initial={page.data}
          companies={companyNames(access)}
          {...(asked?.ok === true && entityId !== undefined
            ? { initialThread: { entityId, threadId: asked.data.thread.id, view: asked.data } }
            : {})}
        />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
