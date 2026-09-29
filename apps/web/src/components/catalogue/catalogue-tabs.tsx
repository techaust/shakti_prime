import { cn } from '@shakti/ui';
import Link from 'next/link';

/** The catalogue's two pages as tabs: plain links, so neither page loads the other's grid. */
export function CatalogueTabs({
  current,
  label,
  items,
  kits,
}: {
  current: 'items' | 'kits';
  label: string;
  items: string;
  kits: string;
}) {
  const tabs = [
    { key: 'items', href: '/catalogue', text: items },
    { key: 'kits', href: '/catalogue/kits', text: kits },
  ] as const;
  return (
    <nav aria-label={label} className="border-border flex gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? 'page' : undefined}
          className={cn(
            'text-text-muted hover:text-text -mb-px rounded-t-md border-b-2 border-transparent px-3 py-2 font-medium',
            current === tab.key && 'border-accent text-text',
          )}
        >
          {tab.text}
        </Link>
      ))}
    </nav>
  );
}
