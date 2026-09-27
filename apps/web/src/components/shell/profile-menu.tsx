'use client';

import { ThemeSchema, type Theme } from '@shakti/contracts';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@shakti/ui';
import { KeyRound, LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useTransition } from 'react';
import { signOut } from '../../actions/auth';
import { useForgetThemeOnThisDevice, useThemeChoice } from '../theme';

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/**
 * The profile menu at the right of the top bar (DESIGN.md §5, §7): who is signed in and in which
 * role, the System / Light / Dark switch saved on the profile, the profile screen with the
 * password change, and sign out.
 */
export function ProfileMenu({ name, role, theme }: { name: string; role: string; theme: Theme }) {
  const t = useTranslations('shell');
  const themes = useTranslations('theme');
  const home = useTranslations('auth.home');
  const errors = useTranslations('errors');
  const { chosen, choose } = useThemeChoice(theme, (key) => {
    toast.error(errors(key));
  });
  const forgetTheme = useForgetThemeOnThisDevice();
  const [signingOut, startSignOut] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          pending={signingOut}
          aria-label={t('profileMenu')}
          className="rounded-full"
        >
          <UserRound aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="flex flex-col px-2 py-1.5">
          <span className="truncate font-[510]">{name}</span>
          <span className="text-text-muted truncate text-xs">{role}</span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{themes('label')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={chosen}
            onValueChange={(value) => {
              const parsed = ThemeSchema.safeParse(value);
              if (parsed.success) choose(parsed.data);
            }}
          >
            {ThemeSchema.options.map((option) => {
              const Icon = THEME_ICONS[option];
              return (
                <DropdownMenuRadioItem
                  key={option}
                  value={option}
                  // Keeps the menu open, so the person sees the screen change behind it.
                  onSelect={(e) => {
                    e.preventDefault();
                  }}
                >
                  <Icon aria-hidden />
                  {themes(option)}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserRound aria-hidden />
            {t('profile')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/profile#change-password">
            <KeyRound aria-hidden />
            {t('changePassword')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            // The next person at a shared desk starts from the device's own theme.
            forgetTheme();
            startSignOut(async () => {
              await signOut();
            });
          }}
        >
          <LogOut aria-hidden />
          {home('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
