'use client';

import type {
  KnowledgeFileDto,
  KnowledgeFilePageDto,
  KnowledgeSearchDto,
  KnowledgeSensitivity,
} from '@shakti/contracts';
import {
  Button,
  EmptyState,
  Field,
  Input,
  Skeleton,
  StatusBadge,
  type StatusTone,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { listKnowledgeFiles, reindexKnowledgeFile, searchKnowledge } from '../../actions/knowledge';
import { formatDate } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';

// The dialogs load when they are opened, so the screen ships only the search and the list.
const AddFileDialog = dynamic(() => import('./add-file-dialog').then((m) => m.AddFileDialog));
const ArchiveDialog = dynamic(() => import('./archive-dialog').then((m) => m.ArchiveDialog));

/** How often the list is read again while a file is being read for search. */
const REFRESH_MS = 4_000;

const STATE_TONE: Readonly<Record<KnowledgeFileDto['state'], StatusTone>> = {
  waiting: 'info',
  indexed: 'success',
  failed: 'danger',
  unavailable: 'warning',
  archived: 'neutral',
};

/** What an Executive or GM may do here: the sensitivities they may give and the upload's limits. */
export interface KnowledgeWriter {
  sensitivities: readonly KnowledgeSensitivity[];
  limit: { contentTypes: readonly string[]; maxBytes: number };
}

export interface KnowledgeCompany {
  id: number;
  name: string;
}

/**
 * `/knowledge` (docs/design/phase1.md §8.4): the staff search over the passages the reader may
 * find, and the vault's files the reader may see with where each stands; an Executive or GM adds,
 * reads again and archives files. The list is read again while a file is being read.
 */
export function KnowledgeScreen({
  initial,
  companies,
  allCompanies,
  writer,
}: {
  initial: KnowledgeFilePageDto;
  companies: readonly KnowledgeCompany[];
  /** All companies is chosen at the top, so a file for every company may be added. */
  allCompanies: boolean;
  writer?: KnowledgeWriter;
}) {
  const t = useTranslations('knowledge');
  const common = useTranslations('common');
  const [files, setFiles] = useState(initial.files);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState<KnowledgeFileDto | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const read = useQuery<KnowledgeFilePageDto>();
  const reindex = useCommand(reindexKnowledgeFile);
  const names = new Map(companies.map((c) => [c.id, c.name]));

  const waiting = files.some((f) => f.state === 'waiting');
  const reload = read.load;
  useEffect(() => {
    if (!waiting) return;
    // While a file is being read, the first page is read again until it settles.
    const timer = setInterval(() => {
      reload(
        () => listKnowledgeFiles({}),
        (page) => {
          setFiles((all) => mergeFirstPage(all, page.files));
        },
      );
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [waiting, reload]);

  function refresh(message: string) {
    setNotice(message);
    read.load(
      () => listKnowledgeFiles({}),
      (page) => {
        setFiles(page.files);
        setCursor(page.nextCursor);
      },
    );
  }

  function loadMore() {
    if (cursor === null) return;
    read.load(
      () => listKnowledgeFiles({ cursor }),
      (page) => {
        setFiles((all) => [...all, ...page.files]);
        setCursor(page.nextCursor);
      },
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <SearchSection />
      <section aria-labelledby="knowledge-files" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="knowledge-files" className="text-h3">
            {t('files.heading')}
          </h2>
          {writer === undefined ? null : (
            <Button
              onClick={() => {
                setNotice(undefined);
                setAdding(true);
              }}
            >
              {t('add')}
            </Button>
          )}
        </div>
        <p role="status" className="text-text-muted text-sm">
          {notice ?? ''}
        </p>
        <FailureMessage failure={read.failure ?? reindex.failure} />
        {files.length === 0 ? (
          <EmptyState message={t('files.empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {files.map((file) => (
              <li
                key={file.id}
                className="border-border bg-surface flex flex-col gap-2 rounded-md border p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 font-medium break-words">{file.title}</h3>
                  <StatusBadge tone={STATE_TONE[file.state]}>
                    {t(`state.${file.state}`)}
                  </StatusBadge>
                </div>
                <dl className="text-text-muted grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="sr-only">{t('files.for')}</dt>
                    <dd>
                      {file.entityId === null
                        ? t('files.everyCompany')
                        : (names.get(file.entityId) ?? t('files.everyCompany'))}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">{t('files.findBy')}</dt>
                    <dd>{t(`sensitivity.${file.sensitivity}`)}</dd>
                  </div>
                  <div>
                    <dt className="sr-only">{t('files.kind')}</dt>
                    <dd>
                      {t(`source.${file.sourceType}`)}
                      {file.state === 'indexed'
                        ? `, ${t('files.passages', { count: file.chunks })}`
                        : ''}
                    </dd>
                  </div>
                </dl>
                <p className="text-text-subtle text-xs">
                  {t('files.added')}{' '}
                  <time dateTime={file.createdAt}>{formatDate(file.createdAt)}</time>
                </p>
                {file.errorReason === null ? null : <ReasonText reason={file.errorReason} />}
                {writer === undefined ? null : (
                  <div
                    role="group"
                    aria-label={t('files.actions', { title: file.title })}
                    className="flex flex-wrap gap-2"
                  >
                    {file.state === 'waiting' ? null : (
                      <Button
                        size="sm"
                        variant="secondary"
                        pending={reindex.pending}
                        onClick={() => {
                          reindex.run(
                            {
                              entityId: file.entityId ?? companies[0]?.id,
                              knowledgeFileId: file.id,
                            },
                            (updated) => {
                              setFiles((all) =>
                                all.map((f) => (f.id === updated.id ? updated : f)),
                              );
                              setNotice(t('readAgainNotice'));
                            },
                          );
                        }}
                      >
                        {t('readAgain')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setArchiving(file);
                      }}
                    >
                      {t('archive')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {cursor === null ? null : (
          <Button
            variant="secondary"
            className="self-start"
            pending={read.pending}
            onClick={loadMore}
          >
            {common('loadMore')}
          </Button>
        )}
      </section>
      {writer !== undefined && adding ? (
        <AddFileDialog
          writer={writer}
          companies={companies}
          allCompanies={allCompanies}
          onClose={() => {
            setAdding(false);
          }}
          onAdded={() => {
            setAdding(false);
            refresh(t('addedNotice'));
          }}
        />
      ) : null}
      {archiving === undefined ? null : (
        <ArchiveDialog
          file={archiving}
          entityId={archiving.entityId ?? companies[0]?.id ?? 0}
          onClose={() => {
            setArchiving(undefined);
          }}
          onArchived={(archived) => {
            setArchiving(undefined);
            setFiles((all) => all.filter((f) => f.id !== archived.id));
            setNotice(t('archivedNotice'));
          }}
        />
      )}
    </div>
  );
}

/** The rows on screen with the first page read again: changed rows updated, new ones first. */
function mergeFirstPage(
  all: readonly KnowledgeFileDto[],
  first: readonly KnowledgeFileDto[],
): KnowledgeFileDto[] {
  const fresh = new Map(first.map((f) => [f.id, f]));
  const shown = new Set(all.map((f) => f.id));
  return [...first.filter((f) => !shown.has(f.id)), ...all.map((f) => fresh.get(f.id) ?? f)];
}

/** Why a file could not be read, in the catalogue's words. */
function ReasonText({ reason }: { reason: NonNullable<KnowledgeFileDto['errorReason']> }) {
  const errors = useTranslations('errors');
  return <p className="text-sm">{errors(reason)}</p>;
}

/** The staff search: a question, then the passages found with the file each comes from. */
function SearchSection() {
  const t = useTranslations('knowledge');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<KnowledgeSearchDto | undefined>();
  const search = useQuery<KnowledgeSearchDto>();
  const asked = useRef('');

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = query.trim();
    if (text.length < 2) return;
    asked.current = text;
    search.load(
      () => searchKnowledge({ query: text }),
      (found) => {
        if (asked.current === text) setAnswer(found);
      },
    );
  }

  return (
    <section aria-labelledby="knowledge-search" className="flex min-w-0 flex-col gap-4">
      <h2 id="knowledge-search" className="text-h3">
        {t('search.heading')}
      </h2>
      <form role="search" onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field
          id="knowledge-query"
          label={t('search.label')}
          helper={t('search.hint')}
          className="min-w-0 grow"
        >
          <Input
            type="search"
            value={query}
            maxLength={500}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </Field>
        <Button type="submit" pending={search.pending}>
          {t('search.search')}
        </Button>
      </form>
      <FailureMessage failure={search.failure} />
      <div aria-live="polite" className="flex flex-col gap-3">
        {search.pending && answer === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : answer === undefined ? null : !answer.available ? (
          <p className="text-text-muted">{t('search.notSwitchedOn')}</p>
        ) : answer.hits.length === 0 ? (
          <p className="text-text-muted">{t('search.none')}</p>
        ) : (
          <>
            <p className="text-text-muted text-sm">
              {t('search.found', { count: answer.hits.length })}
            </p>
            <ol className="flex flex-col gap-3">
              {answer.hits.map((hit) => (
                <li
                  key={`${hit.knowledgeFileId}-${String(hit.position)}`}
                  className="border-border bg-surface flex flex-col gap-1 rounded-md border p-4"
                >
                  <p className="text-text-muted text-sm font-medium">
                    {t('search.from', { title: hit.title })}
                  </p>
                  <p className="break-words whitespace-pre-line">{hit.text}</p>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
