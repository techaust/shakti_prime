import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/** The public root: what the product is, and the way in for staff (DESIGN.md §6). No session is read. */
export default async function HomePage() {
  const t = await getTranslations('app');
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-4">
        <h1 className="text-[length:var(--font-display-size)] leading-[var(--font-display-line)] font-[590] tracking-[-0.01em]">
          {t('name')}
        </h1>
        <p className="text-text-muted text-[length:var(--font-h3-size)] leading-[var(--font-h3-line)]">
          {t('tagline')}
        </p>
      </div>
      <Link
        href="/sign-in"
        className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex h-9 items-center self-start rounded-[var(--radius-md)] px-4 font-[510] max-md:h-11"
      >
        {t('staffSignIn')}
      </Link>
    </main>
  );
}
