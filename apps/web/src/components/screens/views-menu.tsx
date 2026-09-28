'use client';

import type {
  DeletedViewDto,
  DeleteViewInput,
  SavedViewDto,
  SavedViewScreen,
  SavedViewSettings,
  SaveViewInput,
} from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
  Skeleton,
  toast,
} from '@shakti/ui';
import { Bookmark } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { deleteView, listSavedViews, saveView } from '../../actions/profile';
import type { ActionResult } from '../../actions/result';
import { FailureMessage, useFieldFailure } from './failure';
import { formText } from './form-data';
import { useCommand, useQuery } from './use-command';

/** Where views are kept: the person's own saved views, or the design preview's own copy. */
export interface ViewStore {
  list: (input: { screen: SavedViewScreen }) => Promise<ActionResult<SavedViewDto[]>>;
  save: (input: SaveViewInput, idempotencyKey?: unknown) => Promise<ActionResult<SavedViewDto>>;
  remove: (
    input: DeleteViewInput,
    idempotencyKey?: unknown,
  ) => Promise<ActionResult<DeletedViewDto>>;
}

const savedViewStore: ViewStore = { list: listSavedViews, save: saveView, remove: deleteView };

type Open = 'save' | 'update' | 'rename' | 'delete';

/**
 * The Views menu beside a grid (DESIGN.md §6): apply one of the person's saved views, go back to
 * the standard view, save what the grid shows now as a new view, or update, rename or delete the
 * view in use. The views are read the first time the menu opens.
 */
export function ViewsMenu({
  screen,
  current,
  standard,
  onApply,
  store = savedViewStore,
}: {
  screen: SavedViewScreen;
  /** The grid as the person sees it now. */
  current: SavedViewSettings;
  standard: SavedViewSettings;
  onApply: (settings: SavedViewSettings) => void;
  store?: ViewStore;
}) {
  const t = useTranslations('common.grid');
  const common = useTranslations('common');
  const [views, setViews] = useState<SavedViewDto[] | undefined>();
  const [activeId, setActiveId] = useState<string | undefined>();
  const [open, setOpen] = useState<Open | undefined>();
  const { load, pending, failure } = useQuery<SavedViewDto[]>();
  const active = views?.find((v) => v.id === activeId);

  function readViews(isOpen: boolean) {
    if (!isOpen || pending || (views !== undefined && failure === undefined)) return;
    load(() => store.list({ screen }), setViews);
  }

  const close = () => {
    setOpen(undefined);
  };
  const stored = (view: SavedViewDto) => {
    setViews((all) =>
      [...(all ?? []).filter((v) => v.id !== view.id), view].sort((a, b) =>
        a.name.localeCompare(b.name, 'en-IN'),
      ),
    );
    setActiveId(view.id);
  };

  return (
    <>
      <DropdownMenu modal={false} onOpenChange={readViews}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Bookmark aria-hidden />
            <span className="max-w-40 truncate">{active?.name ?? t('viewsButton')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-72">
          <DropdownMenuLabel>{t('viewsTitle')}</DropdownMenuLabel>
          {views === undefined ? (
            failure === undefined ? (
              <div className="flex flex-col gap-2 px-2 py-1.5" aria-busy="true">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <div className="px-2 py-1.5 text-sm">
                <FailureMessage failure={failure} />
              </div>
            )
          ) : views.length === 0 ? (
            <p className="text-text-muted px-2 py-1.5 text-sm">{t('viewsNone')}</p>
          ) : (
            <DropdownMenuRadioGroup
              value={activeId ?? ''}
              onValueChange={(id) => {
                const view = views.find((v) => v.id === id);
                if (view === undefined) return;
                setActiveId(view.id);
                onApply(view.settings);
              }}
            >
              {views.map((v) => (
                <DropdownMenuRadioItem key={v.id} value={v.id}>
                  <span className="truncate">{v.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}
          <DropdownMenuSeparator />
          {active === undefined ? null : (
            <DropdownMenuItem
              onSelect={() => {
                setActiveId(undefined);
                onApply(standard);
              }}
            >
              {t('standardView')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              setOpen('save');
            }}
          >
            {t('saveNewView')}
          </DropdownMenuItem>
          {active === undefined ? null : (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  setOpen('update');
                }}
              >
                {t('updateView')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setOpen('rename');
                }}
              >
                {t('renameView')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setOpen('delete');
                }}
              >
                {t('deleteView')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={open !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) close();
        }}
      >
        {open === undefined ? null : (
          <DialogContent closeLabel={common('close')}>
            {open === 'save' || (open === 'rename' && active !== undefined) ? (
              <NameForm
                store={store}
                screen={screen}
                view={open === 'rename' ? active : undefined}
                settings={open === 'rename' && active !== undefined ? active.settings : current}
                onCancel={close}
                onDone={(view) => {
                  stored(view);
                  close();
                  toast.success(
                    open === 'rename'
                      ? t('viewRenamed', { name: view.name })
                      : t('viewSaved', { name: view.name }),
                  );
                }}
              />
            ) : active === undefined ? null : open === 'update' ? (
              <ConfirmForm
                title={t('updateDialogTitle', { name: active.name })}
                intro={t('updateDialogIntro')}
                submit={t('updateViewSubmit')}
                action={store.save}
                input={{ id: active.id, screen, name: active.name, settings: current }}
                onCancel={close}
                onDone={(view: SavedViewDto) => {
                  stored(view);
                  close();
                  toast.success(t('viewUpdated', { name: view.name }));
                }}
              />
            ) : (
              <ConfirmForm
                title={t('deleteDialogTitle', { name: active.name })}
                intro={t('deleteDialogIntro')}
                submit={t('deleteViewSubmit')}
                danger
                action={store.remove}
                input={{ id: active.id }}
                onCancel={close}
                onDone={() => {
                  const name = active.name;
                  setViews((all) => all?.filter((v) => v.id !== active.id));
                  setActiveId(undefined);
                  close();
                  toast.success(t('viewDeleted', { name }));
                }}
              />
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

const NAME_FIELDS = ['name'] as const;

/** Save as a new view, or rename the view in use: one name field. */
function NameForm({
  store,
  screen,
  view,
  settings,
  onDone,
  onCancel,
}: {
  store: ViewStore;
  screen: SavedViewScreen;
  view: SavedViewDto | undefined;
  settings: SavedViewSettings;
  onDone: (view: SavedViewDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('common.grid');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(store.save);
  const { fieldError, formFailure } = useFieldFailure(failure, NAME_FIELDS);
  const [blank, setBlank] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const name = formText(new FormData(e.currentTarget), 'name');
    setBlank(name === '');
    if (name === '') return;
    run({ ...(view === undefined ? {} : { id: view.id }), screen, name, settings }, onDone);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          {view === undefined ? t('saveDialogTitle') : t('renameDialogTitle', { name: view.name })}
        </DialogTitle>
        <DialogDescription>{t('saveDialogIntro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="saved-view-name"
        label={t('viewName')}
        helper={t('viewNameHelper')}
        error={blank ? t('viewNameMissing') : fieldError('name')}
      >
        <Input
          name="name"
          maxLength={60}
          autoComplete="off"
          required
          defaultValue={view?.name ?? ''}
        />
      </Field>
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={pending}>
          {view === undefined ? t('saveViewSubmit') : t('renameViewSubmit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Update or delete the view in use: a sentence and one button. */
function ConfirmForm<I, T>({
  title,
  intro,
  submit,
  danger = false,
  action,
  input,
  onDone,
  onCancel,
}: {
  title: string;
  intro: string;
  submit: string;
  danger?: boolean;
  action: (input: I, idempotencyKey?: unknown) => Promise<ActionResult<T>>;
  input: I;
  onDone: (data: T) => void;
  onCancel: () => void;
}) {
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(action);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) run(input, onDone);
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{intro}</DialogDescription>
      </DialogHeader>
      <FailureMessage failure={failure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" variant={danger ? 'danger' : 'primary'} pending={pending}>
          {submit}
        </Button>
      </DialogFooter>
    </form>
  );
}
