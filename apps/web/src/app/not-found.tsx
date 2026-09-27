import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/** An address that leads nowhere (AUDIT M38): a plain sentence and a way back. */
export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-[590]">
          {t('title')}
        </h1>
        <p className="text-text-muted">{t('body')}</p>
      </div>
      <Link
        href="/home"
        className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex h-9 items-center self-start rounded-[var(--radius-md)] px-4 font-[510] max-md:h-11"
      >
        {t('home')}
      </Link>
    </main>
  );
}
