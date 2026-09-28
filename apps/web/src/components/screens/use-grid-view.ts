'use client';

import type { SavedViewSettings } from '@shakti/contracts';
import type { ColumnChooser, DensityChoice, GridDensity, GridSort } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';

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
 * How one grid looks right now (DESIGN.md §6): hidden columns, sort and row height, which the
 * Views menu saves and applies. The sort is over the loaded rows (`sortRows`), because no list
 * query takes an order yet.
 */
export function useGridView({
  density: initialDensity = 'compact',
}: { density?: GridDensity } = {}): GridView {
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
  const apply = useCallback((next: SavedViewSettings) => {
    setHidden(next.columns.hidden);
    setSort(next.sort);
    setDensity(next.density);
  }, []);

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
      onSortChange: setSort,
    },
  };
}
