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
  // Opened from the keyboard: the menu then starts on its first item, as Radix's own trigger does.
  const [fromKeyboard, setFromKeyboard] = useState(false);
  const preload = () => {
    void load();
  };
  const open = (viaKeyboard: boolean) => {
    void load().then((component) => {
      setFromKeyboard(viaKeyboard);
      setMenu(() => component);
    });
  };
  const handlers = {
    'aria-haspopup': 'menu' as const,
    'aria-expanded': false,
    onPointerEnter: preload,
    onFocus: preload,
    onClick: () => {
      open(false);
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (!opensMenu(event)) return;
      event.preventDefault();
      open(true);
    },
  };
  return { Menu, fromKeyboard, handlers };
}

export function DeferredCompanySwitcher({
  companies,
  active,
}: {
  companies: readonly CompanyOption[];
  active: number | undefined;
}) {
  const { Menu, fromKeyboard, handlers } =
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
  if (Menu !== undefined) {
    return <Menu companies={companies} active={active} defaultOpen focusFirstItem={fromKeyboard} />;
  }
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
  const { Menu, fromKeyboard, handlers } =
    useDeferredMenu<Parameters<typeof ProfileMenuType>[0]>(loadProfileMenu);
  if (Menu !== undefined) {
    return <Menu name={name} role={role} theme={theme} defaultOpen focusFirstItem={fromKeyboard} />;
  }
  return <ProfileTriggerButton {...handlers} />;
}
