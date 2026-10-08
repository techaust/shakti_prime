'use client';

import type { SavedViewSettings } from '@shakti/contracts';
import type { ColumnChooser, DensityChoice, GridDensity, GridSort } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { sameSort } from './list-sort';

export interface GridView {
  /** What the Views menu saves: the grid as the person sees it now. */
  settings: SavedViewSettings;
  /** The grid as the screen first shows it, for "Standard view". */
  standard: SavedViewSettings;
  apply: (settings: SavedViewSettings) => void;
  /** Spread into `DataGrid`: the column chooser, row height and sort, wired to this state. */
  grid: {
    density: GridDensity;
    densityChoice: DensityChoice;
    columnChooser: ColumnChooser;
    sort: GridSort | null;
    onSortChange: (sort: GridSort | null) => void;
  };
}

/**
 * How one grid looks right now (docs/08-design-system.md §6): hidden columns, sort and row height, which the
 * Views menu saves and applies. A list screen passes `onSortChange` and reads its first page
 * again in the new order from the server whenever the sort changes, from a header or from an
 * applied view, so the order covers every row and not only those loaded; a grid that holds all
 * its rows in memory (`/design`) sorts them itself with `sortRows`.
 */
export function useGridView({
  density: initialDensity = 'compact',
  onSortChange,
}: {
  density?: GridDensity;
  onSortChange?: (sort: GridSort | null) => void;
} = {}): GridView {
  const t = useTranslations('common.grid');
  const [hidden, setHidden] = useState<string[]>([]);
  const [sort, setSort] = useState<GridSort | null>(null);
  const [density, setDensity] = useState<GridDensity>(initialDensity);

  const settings = useMemo<SavedViewSettings>(
    () => ({ columns: { hidden }, sort, filters: {}, density }),
    [hidden, sort, density],
  );
  const standard = useMemo<SavedViewSettings>(
    () => ({ columns: { hidden: [] }, sort: null, filters: {}, density: initialDensity }),
    [initialDensity],
  );
  const changeSort = (next: GridSort | null) => {
    if (sameSort(next, sort)) return;
    setSort(next);
    onSortChange?.(next);
  };
  const apply = (next: SavedViewSettings) => {
    setHidden(next.columns.hidden);
    setDensity(next.density);
    changeSort(next.sort);
  };

  return {
    settings,
    standard,
    apply,
    grid: {
      density,
      densityChoice: {
        label: t('rowHeight'),
        comfortable: t('comfortable'),
        compact: t('compact'),
        onChange: setDensity,
      },
      columnChooser: { label: t('columnsButton'), hidden, onHiddenChange: setHidden },
      sort,
      onSortChange: changeSort,
    },
  };
}
