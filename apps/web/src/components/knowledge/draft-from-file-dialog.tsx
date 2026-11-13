'use client';

import type {
  KnowledgeFileDto,
  KnowledgeFilePageDto,
  PlaybookDirectiveDto,
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
  Select,
  Skeleton,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { listKnowledgeFiles } from '../../actions/knowledge';
import { draftFromVaultFile } from '../../actions/playbook';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import type { PlaybookCompany } from './playbook-screen';

/**
 * Draft rules from a Knowledge Vault file (docs/03-roadmap-appendix/phase2.md §5.4): the files read
 * for search that the person may find (never an Executive-only file), and for a file of every
 * company, which company the drafts are for. The drafts land as drafts for review.
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
  const files = useQuery<KnowledgeFilePageDto>();
  const draft = useCommand(draftFromVaultFile);
  const [choices, setChoices] = useState<KnowledgeFileDto[] | undefined>();
  const [fileId, setFileId] = useState('');
  const firstCompany = companies[0]?.id ?? 0;
  const [forChoice, setForChoice] = useState<number | 'group'>(firstCompany);
  const loadFiles = files.load;

  useEffect(() => {
    loadFiles(
      () => listKnowledgeFiles({}),
      (page) => {
        const usable = page.files.filter(
          (f) => f.state === 'indexed' && f.sensitivity !== 'exec_only',
        );
        setChoices(usable);
        setFileId(usable[0]?.id ?? '');
      },
    );
  }, [loadFiles]);

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
        {choices === undefined ? (
          <Skeleton className="h-20 w-full" />
        ) : choices.length === 0 ? (
          <p className="text-text-muted">{t('drafting.noFiles')}</p>
        ) : (
          <form id="draft-from-file" onSubmit={submit} className="flex flex-col gap-4">
            <Field id="draft-file" label={t('drafting.fileLabel')}>
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
