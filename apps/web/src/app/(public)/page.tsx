import { getTranslations } from 'next-intl/server';

export default async function HomePage() {
  const t = await getTranslations('app');
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-[length:var(--font-display-size)] leading-[var(--font-display-line)] font-semibold tracking-[-0.01em]">
        {t('name')}
      </h1>
      <p className="text-text-muted text-[length:var(--font-h3-size)] leading-[var(--font-h3-line)]">
        {t('tagline')}
      </p>
    </main>
  );
}
