'use client';

import type { Contrast, Theme } from '@shakti/tokens';
import {
  Button,
  CommandPalette,
  DataGrid,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  StatusBadge,
  Textarea,
  toast,
  type DataGridColumn,
  type PaletteGroup,
  type StatusTone,
} from '@shakti/ui';
import { CalendarCheck, Inbox, Plus, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import type en from '../../../messages/en.json';
import { contrastRows, formatRatio, type ContrastRow } from '../../design/contrast-pairs';
import { NAV_ITEMS } from '../../nav';
import { GridViewsPreview } from './grid-views-preview';
import { DateInputPreview, UndoToastButton } from './pattern-previews';

/**
 * The design namespace, handed over by the server page as plain strings: only this page needs
 * it, so it is not sent with every screen (AUDIT L12).
 */
export type DesignCopy = (typeof en)['design'];

const TONES: readonly StatusTone[] = ['neutral', 'accent', 'success', 'warning', 'danger', 'info'];
const PAGE_SIZE = 8;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-text-muted text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Swatch({ hex }: { hex: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="border-border size-4 shrink-0 rounded-sm border"
        style={{ background: hex }}
      />
      <span className="tabular-nums">{hex}</span>
    </span>
  );
}

/**
 * Every `@shakti/ui` component on one theme panel of the design preview (DESIGN.md §2.1, §10).
 * Dialogs, sheets and menus open in the panel's theme; the palette and toasts follow the page's.
 */
export function ComponentGallery({
  theme,
  contrast = 'standard',
  copy,
  navIds,
}: {
  theme: Theme;
  /** The high-contrast panels measure their pairs against the stricter minimums. */
  contrast?: Contrast;
  copy: DesignCopy;
  /** The screens this person may open: the palette lists them as it does in the top bar. */
  navIds: readonly string[];
}) {
  const nav = useTranslations('nav');
  const shell = useTranslations('shell');
  const router = useRouter();
  const panel = contrast === 'high' ? `${theme}-high` : theme;
  const id = (name: string) => `design-${panel}-${name}`;
  const themeClass = `theme-${panel}`;

  const rows = useMemo(() => contrastRows(theme, contrast), [theme, contrast]);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');

  const columns: DataGridColumn<ContrastRow>[] = [
    { id: 'fg', header: copy.colForeground, primary: true, cell: (r) => r.fg },
    { id: 'bg', header: copy.colBackground, cell: (r) => r.bg },
    {
      id: 'sample',
      header: copy.colRatio,
      align: 'end',
      numeric: true,
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <Swatch hex={r.fgHex} />
          {formatRatio(r.ratio)}
        </span>
      ),
    },
    {
      id: 'min',
      header: copy.colNeeds,
      align: 'end',
      numeric: true,
      cell: (r) => formatRatio(r.min),
    },
    {
      id: 'result',
      header: copy.colResult,
      cell: (r) => (
        <StatusBadge tone={r.passes ? 'success' : 'danger'}>
          {r.passes ? copy.passes : copy.fails}
        </StatusBadge>
      ),
    },
  ];

  const palette: PaletteGroup[] = [
    {
      id: 'goto',
      heading: shell('paletteGoto'),
      items: NAV_ITEMS.filter((item) => navIds.includes(item.id)).map((item) => {
        const Icon = item.icon;
        return {
          id: item.id,
          label: nav(item.label),
          icon: <Icon aria-hidden />,
          onSelect: () => {
            router.push(item.href);
          },
        };
      }),
    },
  ];

  return (
    <>
      <Section title={copy.buttons}>
        <div className="flex flex-wrap items-center gap-3">
          <Button>{copy.primary}</Button>
          <Button variant="secondary">{copy.secondary}</Button>
          <Button variant="ghost">{copy.ghost}</Button>
          <Button variant="danger">{copy.danger}</Button>
          <Button variant="link">{copy.link}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled>{copy.unavailable}</Button>
          <Button pending>{copy.pending}</Button>
          <Button size="sm" variant="secondary">
            <Plus aria-hidden />
            {copy.small}
          </Button>
          <Button size="icon" variant="secondary" aria-label={copy.iconLabel}>
            <Plus aria-hidden />
          </Button>
        </div>
      </Section>

      <Section title={copy.fields}>
        <div className="bg-surface border-border grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <Field id={id('name')} label={copy.fieldLabel} helper={copy.fieldHint}>
            <Input name="name" autoComplete="off" />
          </Field>
          <Field id={id('phone')} label={copy.fieldErrorLabel} error={copy.fieldError}>
            <Input name="phone" inputMode="numeric" defaultValue={copy.fieldErrorValue} />
          </Field>
          <Field id={id('pump')} label={copy.selectLabel}>
            <Select name="pump" defaultValue="submersible">
              <option value="submersible">{copy.selectSubmersible}</option>
              <option value="surface">{copy.selectSurface}</option>
            </Select>
          </Field>
          <DateInputPreview id={id('visit')} copy={copy} />
          <Field
            id={id('notes')}
            label={copy.notesLabel}
            helper={copy.notesHint}
            className="sm:col-span-2"
          >
            <Textarea name="notes" rows={3} />
          </Field>
        </div>
      </Section>

      <Section title={copy.statuses}>
        <div className="flex flex-wrap gap-2">
          {TONES.map((tone) => (
            <StatusBadge key={tone} tone={tone}>
              {copy.status[tone]}
            </StatusBadge>
          ))}
        </div>
      </Section>

      <Section title={copy.tables}>
        <DataGrid
          caption={copy.gridCaption}
          columns={columns}
          rows={rows.slice(0, shown)}
          rowKey={(r) => r.id}
          density="compact"
          empty={<EmptyState message={copy.failingEmpty} />}
          loadMore={
            shown < rows.length
              ? {
                  label: copy.loadMore,
                  pending: false,
                  onLoadMore: () => {
                    setShown((n) => n + PAGE_SIZE);
                  },
                }
              : undefined
          }
        />
        <h4 className="text-text-subtle text-xs font-medium">{copy.loadingTitle}</h4>
        <DataGrid
          caption={copy.loadingCaption}
          columns={columns}
          rows={[]}
          rowKey={(r) => r.id}
          loading
          skeletonRows={3}
          density="compact"
          empty={null}
        />
        <h4 className="text-text-subtle text-xs font-medium">{copy.failingTitle}</h4>
        <DataGrid
          caption={copy.failingCaption}
          columns={columns}
          rows={rows.filter((r) => !r.passes)}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={<CalendarCheck />} message={copy.failingEmpty} />}
        />
      </Section>

      <Section title={copy.gridViews.title}>
        <GridViewsPreview copy={copy.gridViews} stages={copy.stage} />
      </Section>

      <Section title={copy.overlays}>
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">{copy.openDialog}</Button>
            </DialogTrigger>
            <DialogContent closeLabel={copy.close} className={themeClass}>
              <DialogHeader>
                <DialogTitle>{copy.dialogTitle}</DialogTitle>
                <DialogDescription>{copy.dialogBody}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">{copy.keep}</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="danger">{copy.discard}</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary">{copy.openSheet}</Button>
            </SheetTrigger>
            <SheetContent closeLabel={copy.close} className={themeClass}>
              <SheetHeader>
                <SheetTitle>{copy.sheetTitle}</SheetTitle>
                <SheetDescription>{copy.sheetBody}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </SheetContent>
          </Sheet>

          <Button
            variant="secondary"
            onClick={() => {
              toast.success(copy.toastBody);
            }}
          >
            {copy.showToast}
          </Button>
          <UndoToastButton copy={copy} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">{copy.openMenu}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className={themeClass}>
              <DropdownMenuItem>
                <Inbox aria-hidden />
                {copy.menuOpen}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <UserPlus aria-hidden />
                {copy.menuAssign}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>{copy.menuLost}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="secondary"
            onClick={() => {
              setPaletteOpen(true);
            }}
          >
            {copy.openPalette}
          </Button>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={(open) => {
              setPaletteOpen(open);
              if (!open) setQuery('');
            }}
            groups={palette}
            title={shell('paletteTitle')}
            inputLabel={shell('paletteInput')}
            emptyLabel={shell('paletteEmpty')}
            query={query}
            onQueryChange={setQuery}
          />
        </div>
      </Section>

      <Section title={copy.emptyStates}>
        <EmptyState
          icon={<Inbox />}
          message={copy.emptyMessage}
          action={
            <Button>
              <Plus aria-hidden />
              {copy.emptyAction}
            </Button>
          }
        />
        <div className="bg-surface border-border flex flex-col gap-2 rounded-lg border p-4">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Section>
    </>
  );
}
