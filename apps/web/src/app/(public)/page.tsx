import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '../../components/brand/logo';
import { LineIcon, type LineIconName } from '../../components/landing/line-icon';

/**
 * The public root: what Shakti Prime does across its whole plan, for the staff of the Shakti
 * group, and the way in (docs/08-design-system.md §6). Written to stay true without edits: no
 * dated words. No session is read and no script is sent: every part is server text, the logo and
 * the product pictures are drawn in the theme's tokens, and the page follows the visitor's theme.
 * The pictures carry only the app's own words (its menu, stages, buttons and statuses), never a
 * name or a figure, and its icons are the menu's own.
 */

/** The production address, so a shared link's preview names the real site from any environment. */
const SITE = 'https://shaktiprime.com';

/** The app's menu in its own order (`nav.ts`), as the leads board shows it. */
const MENU = [
  'home',
  'inbox',
  'leads',
  'calling',
  'customers',
  'quotes',
  'orders',
  'inventoryStock',
] as const;
/** The leads board's first four stages, each with its stage colour and its cards (true: overdue). */
const BOARD = [
  {
    stage: 'new',
    bar: 'bg-stage-new',
    cards: [
      ['w-3/4', false],
      ['w-2/3', true],
      ['w-4/5', false],
    ],
  },
  {
    stage: 'contacted',
    bar: 'bg-stage-contacted',
    cards: [
      ['w-2/3', false],
      ['w-3/4', false],
    ],
  },
  {
    stage: 'qualified',
    bar: 'bg-stage-qualified',
    cards: [
      ['w-4/5', true],
      ['w-1/2', false],
    ],
  },
  { stage: 'quoted', bar: 'bg-stage-quoted', cards: [['w-3/5', false]] },
] as const;
const COMPANIES = ['supreme', 'motorPumps', 'agroSolar', 'rcref'] as const;
/** The three parts shown with a picture: the ones the staff use most, and the assistants. */
const FEATURED = [
  { key: 'leads', icon: 'phoneCall' },
  { key: 'quotes', icon: 'fileText' },
  { key: 'assistants', icon: 'inbox' },
] as const satisfies readonly { key: string; icon: LineIconName }[];
/** The rest of what the system does, across the whole plan. */
const MORE = [
  { key: 'customers', icon: 'contact' },
  { key: 'stock', icon: 'boxes' },
  { key: 'projects', icon: 'hardHat' },
  { key: 'field', icon: 'smartphone' },
  { key: 'finance', icon: 'indianRupee' },
  { key: 'team', icon: 'calendarCheck' },
] as const satisfies readonly { key: string; icon: LineIconName }[];

const WIDTH = 'mx-auto w-full max-w-detail px-4 md:px-6';
const SECTION_HEADING = 'text-h1 md:text-display tracking-[-0.01em] text-balance';
const MOTION = 'transition-colors duration-(--motion-fast) ease-out';
const PRIMARY = `bg-accent text-accent-fg hover:bg-accent-hover inline-flex h-control-phone shrink-0 items-center justify-center rounded-md px-5 font-medium whitespace-nowrap ${MOTION}`;
const SECONDARY = `bg-surface text-text border-border-strong hover:bg-highlight inline-flex h-control shrink-0 items-center rounded-md border px-4 font-medium whitespace-nowrap max-md:h-control-phone ${MOTION}`;
const TEXT_LINK = 'text-accent-text rounded-sm font-medium underline-offset-4 hover:underline';
/** The one card style: a bordered panel, the design system's card radius. */
const CARD = 'border-border rounded-lg border';
/** The panel each picture sits in, one step off its card. */
const PANEL =
  'bg-surface-2 border-border flex h-full flex-col justify-center rounded-md border p-4';
/** A grey bar standing in for a line of a record in the product pictures. */
const LINE = 'bg-text-subtle/25 block h-2 rounded-full';
const NAME_LINE = 'bg-text-subtle/45 block h-2 rounded-full';

export async function generateMetadata(): Promise<Metadata> {
  const [app, t] = await Promise.all([getTranslations('app'), getTranslations('landing')]);
  const title = t('metaTitle');
  const description = t('metaDescription');
  const image = {
    url: '/brand/shakti-prime-preview.jpg',
    width: 1200,
    height: 630,
    alt: t('previewAlt'),
  };
  return {
    metadataBase: new URL(SITE),
    title: { absolute: title },
    description,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      url: '/',
      siteName: app('name'),
      locale: 'en_IN',
      title,
      description,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

/** The leads board as the app draws it: the menu, the search, the stage columns and their cards. */
async function BoardPicture({ name }: { name: string }) {
  const [t, nav, shell] = await Promise.all([
    getTranslations('landing'),
    getTranslations('nav'),
    getTranslations('shell'),
  ]);
  return (
    <div
      role="img"
      aria-label={t('previewLabel')}
      className={`bg-surface shadow-1 overflow-hidden ${CARD}`}
    >
      <div className="bg-surface-2 border-border flex h-11 items-center gap-3 border-b px-4">
        <Logo label={name} small className="size-5 shrink-0" />
        <span className="bg-surface border-border text-caption text-text-subtle flex h-7 w-full max-w-56 items-center truncate rounded-md border px-2.5">
          {shell('search')}
        </span>
        <span className="bg-accent-soft ml-auto size-6 shrink-0 rounded-full" />
      </div>
      <div className="flex">
        <div className="border-border hidden w-40 shrink-0 flex-col gap-1 border-r p-3 sm:flex lg:hidden xl:flex">
          {MENU.map((item) => (
            <span
              key={item}
              className={`text-caption truncate rounded-md px-2 py-1.5 ${
                item === 'leads' ? 'bg-accent-soft text-accent-text font-medium' : 'text-text-muted'
              }`}
            >
              {nav(item)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{nav('leads')}</span>
            <span className="bg-accent text-accent-fg text-caption shrink-0 rounded-md px-2.5 py-1 font-medium">
              {nav('newLead')}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
            {BOARD.map(({ stage, bar, cards }, column) => (
              <div
                key={stage}
                className={`flex min-w-0 flex-col gap-2 ${column === 3 ? 'max-md:hidden lg:max-xl:hidden' : ''}`}
              >
                <span className={`${bar} block h-0.75 rounded-full`} />
                <span className="text-caption text-text-muted truncate font-medium">
                  {t(`stages.${stage}`)}
                </span>
                {cards.map(([width, overdue], i) => (
                  <span
                    key={`${stage}-${String(i)}`}
                    className="bg-surface border-border flex flex-col gap-2 rounded-md border p-2.5"
                  >
                    <span className={`${NAME_LINE} ${width}`} />
                    <span className={`${LINE} w-1/2`} />
                    <span className="flex items-center justify-between pt-1">
                      <span className="bg-accent-soft size-4 rounded-full" />
                      <span
                        className={`size-1.5 rounded-full ${overdue ? 'bg-sla-warn' : 'bg-sla-ok'}`}
                      />
                    </span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The calling queue: the lead being called, and the next ones waiting. */
function QueuePicture() {
  return (
    <div className={`${PANEL} gap-2`}>
      {['w-1/2', 'w-2/5', 'w-3/5'].map((width, i) => (
        <span
          key={width}
          className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${
            i === 0 ? 'bg-accent-soft border-accent/30' : 'bg-surface border-border'
          }`}
        >
          <span className="bg-accent/20 size-6 shrink-0 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={`${NAME_LINE} ${width}`} />
            <span className={`${LINE} w-1/3`} />
          </span>
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
              i === 0 ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-text-subtle'
            }`}
          >
            <LineIcon name="phoneCall" className="size-3.5" />
          </span>
        </span>
      ))}
    </div>
  );
}

/** A quote: its lines with their amounts, the total in the accent, and the order it became. */
async function QuotePicture() {
  const orders = await getTranslations('orders');
  return (
    <div className={`${PANEL} gap-3`}>
      {['w-1/2', 'w-2/5', 'w-3/5', 'w-1/3'].map((width) => (
        <span key={width} className="flex items-center justify-between gap-6">
          <span className={`${LINE} ${width}`} />
          <span className={`${LINE} w-12`} />
        </span>
      ))}
      <span className="border-border flex items-center justify-between gap-6 border-t pt-3">
        <span className={`${NAME_LINE} w-1/4`} />
        <span className="bg-accent block h-2.5 w-16 rounded-full" />
      </span>
      <span className="bg-success-soft text-success text-caption inline-flex items-center gap-1.5 self-end rounded-sm px-2 py-1 font-medium">
        <LineIcon name="check" className="size-3.5" />
        {orders('state.confirmed')}
      </span>
    </div>
  );
}

/** The Agent Inbox: an assistant's draft waiting for a person to approve it, and Talk to Shakti. */
async function AssistantPicture() {
  const [nav, agents] = await Promise.all([getTranslations('nav'), getTranslations('agents')]);
  return (
    <div className={`${PANEL} gap-3`}>
      <span className="text-caption text-text-muted flex items-center gap-1.5 font-medium">
        <LineIcon name="inbox" className="text-accent-text size-3.5" />
        {nav('inbox')}
      </span>
      <span className="bg-surface border-border flex flex-col gap-2 rounded-md border p-3">
        <span className={`${NAME_LINE} w-2/3`} />
        <span className={`${LINE} w-full`} />
        <span className={`${LINE} w-4/5`} />
        <span className="bg-accent text-accent-fg text-caption mt-1 self-end rounded-md px-2.5 py-1 font-medium">
          {agents('inbox.approve')}
        </span>
      </span>
      <span className="bg-accent-soft text-accent-text text-caption inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1.5 font-medium">
        <LineIcon name="audioLines" className="size-3.5" />
        {nav('voice')}
      </span>
    </div>
  );
}

const PICTURES = {
  leads: QueuePicture,
  quotes: QuotePicture,
  assistants: AssistantPicture,
} as const;

/** One thing the system does: its icon, its name and a sentence, spaced the same everywhere. */
function Feature({
  icon,
  heading,
  body,
  large = false,
}: {
  icon: LineIconName;
  heading: ReactNode;
  body: string;
  large?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3 sm:flex-col sm:gap-4">
        <LineIcon
          name={icon}
          className={`text-accent-text size-5 shrink-0 sm:mt-0 ${large ? 'mt-1' : 'mt-0.5'}`}
        />
        <h3 className={`text-balance ${large ? 'text-h2' : 'text-h3'}`}>{heading}</h3>
      </div>
      <p className="text-text-muted text-h3 mt-2 max-w-prose font-normal text-pretty">{body}</p>
    </div>
  );
}

export default async function HomePage() {
  const [app, shell, t] = await Promise.all([
    getTranslations('app'),
    getTranslations('shell'),
    getTranslations('landing'),
  ]);
  const name = app('name');
  // A phrase a heading keeps whole: its own line until the cards sit three across.
  const phrase = (chunks: ReactNode) => <span className="block lg:inline">{chunks}</span>;
  // On a phone each phrase of the headline takes its own line; wider, they stay whole.
  const line = (chunks: ReactNode) => (
    <span className="block sm:inline sm:whitespace-nowrap">{chunks}</span>
  );

  return (
    <div className="bg-bg text-text flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="bg-surface text-text border-border-strong shadow-1 sr-only z-50 rounded-md border px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {shell('skipToContent')}
      </a>
      <header className="border-border border-b">
        <div
          className={`${WIDTH} flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2`}
        >
          <Link
            href="/"
            translate="no"
            className="h-control-phone inline-flex items-center rounded-md"
          >
            <Logo label={name} className="h-8 w-auto md:h-9" />
          </Link>
          <Link href="/sign-in" className={SECONDARY}>
            {app('staffSignIn')}
          </Link>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        <section
          aria-labelledby="hero-heading"
          className={`${WIDTH} grid gap-12 pt-12 pb-10 md:pt-20 lg:grid-cols-2 lg:items-center xl:grid-cols-5`}
        >
          <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
            <h1
              id="hero-heading"
              className="text-display md:text-hero tracking-[-0.01em] text-balance"
            >
              {t.rich('heroHeading', { line })}
            </h1>
            <p className="text-text-muted text-h3 md:text-h2 max-w-xl font-normal text-pretty">
              {t('heroLead')}
            </p>
            <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-center">
              <Link href="/sign-in" className={`${PRIMARY} self-start`}>
                {app('staffSignIn')}
              </Link>
              <p className="text-text-muted text-pretty">{t('inviteNote')}</p>
            </div>
          </div>
          <div className="min-w-0 xl:col-span-3">
            <BoardPicture name={name} />
          </div>
        </section>

        <section aria-labelledby="companies-label" className={`${WIDTH} pb-16 md:pb-20`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8">
            <p id="companies-label" className="text-text-muted text-h3 shrink-0 font-normal">
              {t('companiesLabel')}
            </p>
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-8">
              {COMPANIES.map((company) => (
                <li key={company} className="text-h3 flex items-center gap-2" translate="no">
                  <LineIcon name="building" className="text-accent-text size-5 shrink-0" />
                  {t(`companies.${company}`)}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="features-heading" className="border-border border-y">
          <div className={`${WIDTH} py-16 md:py-24`}>
            <h2 id="features-heading" className={SECTION_HEADING}>
              {t('featuresHeading')}
            </h2>
            <ul className="mt-10 grid gap-6 lg:grid-cols-3">
              {FEATURED.map(({ key, icon }) => {
                const Picture = PICTURES[key];
                return (
                  <li
                    key={key}
                    className={`bg-surface flex min-w-0 flex-col p-5 sm:p-6 md:grid md:grid-cols-2 md:items-center md:gap-8 md:p-8 lg:row-span-2 lg:grid-cols-1 lg:grid-rows-subgrid lg:items-stretch lg:gap-6 ${CARD}`}
                  >
                    <Feature
                      icon={icon}
                      heading={t.rich(`features.${key}.heading`, { phrase })}
                      body={t(`features.${key}.body`)}
                      large
                    />
                    <div aria-hidden className="hidden h-52 md:block">
                      <Picture />
                    </div>
                  </li>
                );
              })}
            </ul>
            <ul className="mt-12 grid gap-x-6 gap-y-8 sm:grid-cols-2 sm:gap-y-10 lg:grid-cols-3">
              {MORE.map(({ key, icon }) => (
                <li key={key}>
                  <Feature
                    icon={icon}
                    heading={t(`features.${key}.heading`)}
                    body={t(`features.${key}.body`)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="closing-heading" className={`${WIDTH} py-16`}>
          <div
            className={`bg-surface-2 flex flex-col gap-6 p-5 sm:p-6 md:p-12 lg:flex-row lg:items-center lg:justify-between ${CARD}`}
          >
            <div className="flex flex-col gap-2">
              <h2 id="closing-heading" className={SECTION_HEADING}>
                {t('closingHeading')}
              </h2>
              <p className="text-text-muted text-h3 font-normal">{t('closingBody')}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
              <Link href="/sign-in" className={`${PRIMARY} self-start sm:self-center`}>
                {app('staffSignIn')}
              </Link>
              <Link
                href="/forgot-password"
                className={`${TEXT_LINK} min-h-control-phone inline-flex items-center self-start sm:self-center`}
              >
                {t('forgotPassword')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-border border-t">
        <div className={`${WIDTH} flex flex-col gap-3 py-8`}>
          <div className="flex items-center gap-3">
            <span aria-hidden className="shrink-0">
              <Logo label={name} small className="size-6" />
            </span>
            <p className="text-text-muted text-caption">{t('footerNote')}</p>
          </div>
          <p className="text-text-subtle text-caption pl-9">
            {t.rich('credit', {
              year: String(new Date().getFullYear()),
              // The year changes each January; the landing journey masks it (`data-year`).
              yearMark: (chunks) => <span data-year>{chunks}</span>,
              link: (chunks) => (
                <a
                  href="https://techaust.com"
                  translate="no"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-text rounded-sm font-medium underline underline-offset-4"
                >
                  {chunks}
                  <span className="sr-only">{t('newTab')}</span>
                </a>
              ),
            })}
          </p>
        </div>
      </footer>
    </div>
  );
}
