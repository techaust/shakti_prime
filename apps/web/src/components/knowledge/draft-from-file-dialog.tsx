'use client';

import type {
  PlaybookDirectiveDto,
  PlaybookSourceFileDto,
  PlaybookSourcePageDto,
} from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Skeleton,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { draftFromVaultFile, listPlaybookSources } from '../../actions/playbook';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import type { PlaybookCompany } from './playbook-screen';

/**
 * Draft rules from a Knowledge Vault file (docs/03-roadmap-appendix/phase2.md §5.4): any file read
 * for search that the person may find (never an Executive-only file), found by name and a page at
 * a time, and for a file of every company, which company the drafts are for. The drafts land as drafts for review.
 */
export function DraftFromFileDialog({
  companies,
  allCompanies,
  onClose,
  onDrafted,
}: {
  companies: readonly PlaybookCompany[];
  allCompanies: boolean;
  onClose: () => void;
  onDrafted: (drafts: PlaybookDirectiveDto[]) => void;
}) {
  const t = useTranslations('playbook');
  const common = useTranslations('common');
  const files = useQuery<PlaybookSourcePageDto>();
  const draft = useCommand(draftFromVaultFile);
  const [choices, setChoices] = useState<PlaybookSourceFileDto[] | undefined>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [fileId, setFileId] = useState('');
  const firstCompany = companies[0]?.id ?? 0;
  const [forChoice, setForChoice] = useState<number | 'group'>(firstCompany);
  const loadFiles = files.load;

  // The files read for search that the person may draft from, by name; typing narrows them, and
  // More files reads the next page, so every file is in reach.
  useEffect(() => {
    const timer = setTimeout(() => {
      loadFiles(
        () => listPlaybookSources({ query }),
        (page) => {
          setChoices(page.files);
          setCursor(page.nextCursor);
          setFileId(page.files[0]?.id ?? '');
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [loadFiles, query]);

  function more() {
    if (cursor === null) return;
    loadFiles(
      () => listPlaybookSources({ query, cursor }),
      (page) => {
        setChoices((all) => [...(all ?? []), ...page.files]);
        setCursor(page.nextCursor);
      },
    );
  }

  const file = choices?.find((f) => f.id === fileId);

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file === undefined) return;
    const group = file.entityId === null && forChoice === 'group';
    draft.run(
      {
        entityId: file.entityId ?? (forChoice === 'group' ? firstCompany : forChoice),
        knowledgeFileId: file.id,
        wholeGroup: group,
      },
      (answer) => {
        onDrafted(answer.drafts);
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        <DialogHeader>
          <DialogTitle>{t('drafting.title')}</DialogTitle>
          <DialogDescription>{t('drafting.intro')}</DialogDescription>
        </DialogHeader>
        <FailureMessage failure={files.failure ?? draft.failure} />
        <Field id="draft-search" label={t('drafting.searchLabel')}>
          <Input
            type="search"
            value={query}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </Field>
        {choices === undefined ? (
          <Skeleton className="h-20 w-full" />
        ) : choices.length === 0 ? (
          <p className="text-text-muted">{t('drafting.noFiles')}</p>
        ) : (
          <form id="draft-from-file" onSubmit={submit} className="flex flex-col gap-4">
            <Field
              id="draft-file"
              label={t('drafting.fileLabel')}
              actions={
                cursor === null ? undefined : (
                  <Button type="button" variant="secondary" pending={files.pending} onClick={more}>
                    {t('drafting.more')}
                  </Button>
                )
              }
            >
              <Select
                value={fileId}
                onChange={(e) => {
                  setFileId(e.target.value);
                }}
              >
                {choices.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </Select>
            </Field>
            {file?.entityId !== null ? null : (
              <Field id="draft-for" label={t('drafting.forLabel')}>
                <Select
                  value={String(forChoice)}
                  onChange={(e) => {
                    setForChoice(e.target.value === 'group' ? 'group' : Number(e.target.value));
                  }}
                >
                  {allCompanies ? (
                    <option value="group">{t('drafting.everyCompany')}</option>
                  ) : null}
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {draft.pending ? (
              <p role="status" className="text-text-muted text-sm">
                {t('drafting.working')}
              </p>
            ) : null}
          </form>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('drafting.cancel')}
          </Button>
          <Button
            type="submit"
            form="draft-from-file"
            disabled={file === undefined}
            pending={draft.pending}
          >
            {t('drafting.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
