'use client';

import type { PaletteSearchDto } from '@shakti/contracts';
import { CommandPalette, type PaletteGroup, type PaletteItem } from '@shakti/ui';
import { FileUp, ListTodo, MailPlus, UserPlus, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { searchPalette } from '../../actions/search';
import type { NavItem } from '../../nav';
import { formatCount } from '../../screens/format';
import {
  foundCount,
  PALETTE_ACTIONS,
  PALETTE_DEBOUNCE_MS,
  paletteSections,
  searchText,
  type PaletteAction,
  type PaletteEntry,
} from '../../screens/palette';

const ACTION_ICONS: Record<PaletteAction['id'], typeof UserPlus> = {
  'new-lead': UserPlus,
  'new-import': FileUp,
  invite: MailPlus,
};

/** One search's answer, kept with the text it answers so a late reply never shows for newer text. */
type Answer = { q: string; found: PaletteSearchDto } | { q: string; failed: true };

/**
 * The shell's ⌘K palette (DESIGN.md §6): Go to the screens the caller may open, Search their
 * leads (and team members, for a user administrator) once two characters are typed and typing
 * pauses, and the Actions their grants allow. How many matches were found is read out in words.
 */
export function ShellPalette({
  open,
  onOpenChange,
  nav,
  actionIds,
  searchable,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The screens the caller may open, from `visibleNav()`. */
  nav: readonly NavItem[];
  /** The ids of the actions the caller's grants allow, from `visibleActions()`. */
  actionIds: readonly string[];
  /** Whether the caller may search anything at all, from `canSearch()`. */
  searchable: boolean;
}) {
  const t = useTranslations('shell');
  const navLabel = useTranslations('nav');
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<Answer | undefined>();

  const text = searchable ? searchText(query) : undefined;
  useEffect(() => {
    if (text === undefined || !open) return;
    let current = true;
    const timer = setTimeout(() => {
      void searchPalette({ q: text }).then(
        (result) => {
          if (!current) return;
          setAnswer(result.ok ? { q: text, found: result.data } : { q: text, failed: true });
        },
        () => {
          if (current) setAnswer({ q: text, failed: true });
        },
      );
    }, PALETTE_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, open]);

  // Only an answer to the text in the box counts; anything else is still being looked up.
  const settled = text !== undefined && answer?.q === text ? answer : undefined;
  const found = settled !== undefined && 'found' in settled ? settled.found : undefined;
  const failed = settled !== undefined && 'failed' in settled;
  const searching = text !== undefined && settled === undefined;

  const actions = PALETTE_ACTIONS.filter((a) => actionIds.includes(a.id));
  const sections = paletteSections({ nav, actions, found });
  const headings = {
    goto: t('paletteGoto'),
    search: t('paletteSearch'),
    actions: t('paletteActions'),
  };

  function toItem(entry: PaletteEntry): PaletteItem {
    const go = () => {
      router.push(entry.href);
    };
    switch (entry.kind) {
      case 'page': {
        const Icon = entry.item.icon;
        return {
          id: entry.id,
          label: navLabel(entry.item.label),
          keywords: [entry.href],
          icon: <Icon aria-hidden />,
          onSelect: go,
        };
      }
      case 'lead':
        return {
          id: entry.id,
          label: entry.hit.customerName,
          hint:
            entry.hit.village === null
              ? t('paletteLead')
              : t('paletteLeadAt', { village: entry.hit.village }),
          icon: <ListTodo aria-hidden />,
          onSelect: go,
        };
      case 'person':
        return {
          id: entry.id,
          label: entry.hit.displayName,
          hint: t('palettePerson'),
          keywords: [entry.hit.email],
          icon: <UserRound aria-hidden />,
          onSelect: go,
        };
      case 'action': {
        const Icon = ACTION_ICONS[entry.action.id];
        return {
          id: entry.id,
          label: t(`actions.${entry.action.label}`),
          icon: <Icon aria-hidden />,
          onSelect: go,
        };
      }
    }
  }

  const groups: PaletteGroup[] = sections.map((section) => ({
    id: section.id,
    heading: headings[section.id],
    prefiltered: section.prefiltered,
    items: section.entries.map(toItem),
  }));

  const status = searching
    ? t('paletteSearching')
    : failed
      ? t('paletteSearchFailed')
      : found === undefined
        ? undefined
        : t('paletteFound', { count: foundCount(found), shown: formatCount(foundCount(found)) });

  return (
    <CommandPalette
      open={open}
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) {
          setQuery('');
          setAnswer(undefined);
        }
      }}
      groups={groups}
      title={t('paletteTitle')}
      inputLabel={t('paletteInput')}
      emptyLabel={
        searching ? t('paletteSearching') : failed ? t('paletteSearchFailed') : t('paletteEmpty')
      }
      query={query}
      onQueryChange={setQuery}
      {...(status === undefined ? {} : { status })}
    />
  );
}
