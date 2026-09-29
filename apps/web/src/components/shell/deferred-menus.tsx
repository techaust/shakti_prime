'use client';

import type { Theme } from '@shakti/contracts';
import { useState, type ComponentType, type KeyboardEvent } from 'react';
import type { CompanySwitcher as CompanySwitcherType } from './company-switcher';
import {
  CompanyTriggerButton,
  Dot,
  ProfileTriggerButton,
  type CompanyOption,
} from './menu-triggers';
import type { ProfileMenu as ProfileMenuType } from './profile-menu';

/**
 * The company switcher and the profile menu are Radix dropdown menus, about a sixth of every staff
 * page's first load. The top bar draws their buttons at once and fetches a menu when the pointer
 * reaches its button or the button takes focus; a press opens it as soon as it has arrived, with
 * the button in place until then. Enter, Space and the down arrow open it from the keyboard, as
 * they do on the menu's own trigger, and the open menu takes focus as it always does.
 */
const loadCompanySwitcher = () => import('./company-switcher').then((m) => m.CompanySwitcher);
const loadProfileMenu = () => import('./profile-menu').then((m) => m.ProfileMenu);

/** Opens on the keys a menu button answers to (WAI-ARIA menu button pattern). */
function opensMenu(event: KeyboardEvent): boolean {
  return event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ';
}

/** The loaded menu once asked for; `open` fetches it (again from the cache) and shows it. */
function useDeferredMenu<P>(load: () => Promise<ComponentType<P>>) {
  const [Menu, setMenu] = useState<ComponentType<P> | undefined>(undefined);
  const preload = () => {
    void load();
  };
  const open = () => {
    void load().then((component) => {
      setMenu(() => component);
    });
  };
  const handlers = {
    'aria-haspopup': 'menu' as const,
    'aria-expanded': false,
    onPointerEnter: preload,
    onFocus: preload,
    onClick: open,
    onKeyDown: (event: KeyboardEvent) => {
      if (!opensMenu(event)) return;
      event.preventDefault();
      open();
    },
  };
  return { Menu, handlers };
}

export function DeferredCompanySwitcher({
  companies,
  active,
}: {
  companies: readonly CompanyOption[];
  active: number | undefined;
}) {
  const { Menu, handlers } =
    useDeferredMenu<Parameters<typeof CompanySwitcherType>[0]>(loadCompanySwitcher);
  const only = companies.length === 1 ? companies[0] : undefined;
  if (only !== undefined) {
    return (
      <span className="text-text flex min-w-0 items-center gap-2 px-2 font-medium">
        <Dot entityId={only.entityId} />
        <span className="truncate">{only.label}</span>
      </span>
    );
  }
  if (Menu !== undefined) return <Menu companies={companies} active={active} defaultOpen />;
  return (
    <CompanyTriggerButton current={companies.find((c) => c.entityId === active)} {...handlers} />
  );
}

export function DeferredProfileMenu({
  name,
  role,
  theme,
}: {
  name: string;
  role: string;
  theme: Theme;
}) {
  const { Menu, handlers } =
    useDeferredMenu<Parameters<typeof ProfileMenuType>[0]>(loadProfileMenu);
  if (Menu !== undefined) return <Menu name={name} role={role} theme={theme} defaultOpen />;
  return <ProfileTriggerButton {...handlers} />;
}
