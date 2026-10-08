'use client';

import type { SavedViewDto } from '@shakti/contracts';
import {
  DataGrid,
  EmptyState,
  sortRows,
  StatusBadge,
  type DataGridColumn,
  type StatusTone,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type en from '../../../messages/en.json';
import type { ActionResult } from '../../actions/result';
import { formatCount } from '../../screens/format';
import { useGridView } from '../screens/use-grid-view';
import { ViewsMenu, type ViewStore } from '../screens/views-menu';

type Copy = (typeof en)['design']['gridViews'];
type StageCopy = (typeof en)['design']['stage'];
type RowKey = keyof Copy['rows'];
type Stage = keyof StageCopy;

/** The preview's rows: words from the catalogue, sizes and stages here. */
const ROWS: readonly { id: RowKey; hp: number; stage: Stage }[] = [
  { id: 'chomu', hp: 5, stage: 'stage-qualified' },
  { id: 'kishangarh', hp: 2, stage: 'stage-new' },
  { id: 'phagi', hp: 7.5, stage: 'stage-quoted' },
  { id: 'bassi', hp: 10, stage: 'stage-contacted' },
  { id: 'dudu', hp: 3, stage: 'stage-won' },
  { id: 'sanganer', hp: 1, stage: 'stage-lost' },
];

const STAGE_ORDER: readonly Stage[] = [
  'stage-new',
  'stage-contacted',
  'stage-qualified',
  'stage-quoted',
  'stage-won',
  'stage-lost',
];

const STAGE_TONE: Record<Stage, StatusTone> = {
  'stage-new': 'neutral',
  'stage-contacted': 'info',
  'stage-qualified': 'accent',
  'stage-quoted': 'warning',
  'stage-won': 'success',
  'stage-lost': 'neutral',
};

/**
 * Views kept on this page only: the preview shows the Views menu working without writing
 * anything to the person's own saved views.
 */
function pageViewStore(): ViewStore {
  let views: SavedViewDto[] = [];
  const answer = <T,>(data: T): Promise<ActionResult<T>> => Promise.resolve({ ok: true, data });
  return {
    list: ({ screen }) => answer(views.filter((v) => v.screen === screen)),
    save: (input) => {
      const name = input.name.trim();
      if (views.some((v) => v.name === name && v.screen === input.screen && v.id !== input.id)) {
        return Promise.resolve({ ok: false, error: 'saved_view_name_taken' });
      }
      const view: SavedViewDto = {
        // The preview keeps its views in memory, so any unique id serves.
        id: input.id ?? crypto.randomUUID(),
        screen: input.screen,
        name,
        settings: input.settings,
        updatedAt: new Date().toISOString(),
      };
      views = [...views.filter((v) => v.id !== view.id), view];
      return answer(view);
    },
    remove: ({ id }) => {
      views = views.filter((v) => v.id !== id);
      return answer({ id });
    },
  };
}

/**
 * The data grid with everything switched on (docs/08-design-system.md §6): sortable headers, the column chooser
 * with the row height, row selection with its count, and the Views menu.
 */
export function GridViewsPreview({ copy, stages }: { copy: Copy; stages: StageCopy }) {
  const grid = useTranslations('common.grid');
  const view = useGridView({ density: 'compact' });
  const [store] = useState(pageViewStore);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const size = (hp: number) => copy.size.replace('{hp}', new Intl.NumberFormat('en-IN').format(hp));

  const columns: DataGridColumn<(typeof ROWS)[number]>[] = [
    {
      id: 'village',
      header: copy.colVillage,
      primary: true,
      cell: (r) => copy.rows[r.id].village,
      sortValue: (r) => copy.rows[r.id].village,
    },
    {
      id: 'product',
      header: copy.colProduct,
      cell: (r) => copy.rows[r.id].product,
      sortValue: (r) => copy.rows[r.id].product,
    },
    {
      id: 'size',
      header: copy.colSize,
      align: 'end',
      numeric: true,
      cell: (r) => size(r.hp),
      sortValue: (r) => r.hp,
    },
    {
      id: 'company',
      header: copy.colCompany,
      cell: (r) => copy.rows[r.id].company,
      sortValue: (r) => copy.rows[r.id].company,
    },
    {
      id: 'stage',
      header: copy.colStage,
      cell: (r) => <StatusBadge tone={STAGE_TONE[r.stage]}>{stages[r.stage]}</StatusBadge>,
      sortValue: (r) => STAGE_ORDER.indexOf(r.stage),
    },
  ];

  return (
    <>
      <p className="text-text-muted text-sm">{copy.intro}</p>
      <DataGrid
        caption={copy.caption}
        columns={columns}
        rows={sortRows(ROWS, columns, view.grid.sort)}
        rowKey={(r) => r.id}
        empty={<EmptyState message={copy.intro} />}
        {...view.grid}
        selectable={{
          selected,
          onSelectedChange: setSelected,
          selectAllLabel: copy.selectAll,
          selectRowLabel: (r) => copy.selectRow.replace('{village}', copy.rows[r.id].village),
          summary: (count) => grid('selected', { count, shown: formatCount(count) }),
        }}
        toolbar={
          <ViewsMenu
            screen="leads"
            current={view.settings}
            standard={view.standard}
            onApply={view.apply}
            store={store}
          />
        }
      />
    </>
  );
}
