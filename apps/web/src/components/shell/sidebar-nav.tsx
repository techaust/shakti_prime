'use client';

import { cn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeNavId, type NavGroup, type NavItem } from '../../nav';

const GROUPS: readonly NavGroup[] = ['work', 'admin', 'more'];

/**
 * The screens this person may open, grouped as in `nav.ts`. Shared by the desktop sidebar and the
 * phone menu. Collapsed, each item shows only its icon; its name stays for screen readers and
 * appears on hover.
 */
export function SidebarNav({
  items,
  collapsed = false,
  onNavigate,
}: {
  items: readonly NavItem[];
  collapsed?: boolean;
  /** Called after a link is followed, so the phone menu can close. */
  onNavigate?: () => void;
}) {
  const t = useTranslations('nav');
  const shell = useTranslations('shell');
  const active = activeNavId(usePathname(), items);
  return (
    <nav aria-label={shell('mainMenu')} className="flex flex-col gap-4">
      {GROUPS.map((group) => {
        const inGroup = items.filter((i) => i.group === group);
        if (inGroup.length === 0) return null;
        return (
          <div key={group} className="flex flex-col gap-1">
            {group === 'admin' ? (
              collapsed ? (
                <span aria-hidden className="bg-border mx-2 h-px" />
              ) : (
                <h2 className="text-text-subtle px-2 text-xs font-medium">
                  {shell('adminHeading')}
                </h2>
              )
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {inGroup.map((item) => {
                const Icon = item.icon;
                const current = item.id === active;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={current ? 'page' : undefined}
                      title={collapsed ? t(item.label) : undefined}
                      onClick={() => {
                        onNavigate?.();
                      }}
                      className={cn(
                        'text-text-muted hover:bg-highlight hover:text-text flex h-8 items-center gap-2.5 rounded-md px-2 font-medium max-md:h-control-phone',
                        'transition-colors duration-(--motion-fast) ease-out',
                        'aria-[current=page]:bg-highlight aria-[current=page]:text-text',
                        collapsed && 'justify-center px-0',
                      )}
                    >
                      <Icon
                        aria-hidden
                        className={cn('size-4 shrink-0', current && 'text-accent')}
                      />
                      <span className={cn('truncate', collapsed && 'sr-only')}>
                        {t(item.label)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
