import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/** The public root: what the product is, and the way in for staff (docs/08-design-system.md §6). No session is read. */
export default async function HomePage() {
  const t = await getTranslations('app');
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-4">
        <h1 className="text-display tracking-[-0.01em]">{t('name')}</h1>
        <p className="text-text-muted text-h3 font-normal">{t('tagline')}</p>
      </div>
      <Link
        href="/sign-in"
        className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex h-9 items-center self-start rounded-md px-4 font-medium max-md:h-11"
      >
        {t('staffSignIn')}
      </Link>
    </main>
  );
}
