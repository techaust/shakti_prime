'use client';

import type { KnowledgeFileDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { archiveKnowledgeFile } from '../../actions/knowledge';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

/**
 * Archive a vault file (`knowledge.file.archive`), asked once more since it cannot be undone: its
 * passages leave search at once.
 */
export function ArchiveDialog({
  file,
  entityId,
  onClose,
  onArchived,
}: {
  file: KnowledgeFileDto;
  /** A company of the request: the file's own, or for a file of every company any one viewed. */
  entityId: number;
  onClose: () => void;
  onArchived: (file: KnowledgeFileDto) => void;
}) {
  const t = useTranslations('knowledge');
  const common = useTranslations('common');
  const archive = useCommand(archiveKnowledgeFile);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        <DialogHeader>
          <DialogTitle>{t('archiveTitle')}</DialogTitle>
          <DialogDescription>{t('archiveIntro', { title: file.title })}</DialogDescription>
        </DialogHeader>
        <FailureMessage failure={archive.failure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button
            variant="danger"
            pending={archive.pending}
            onClick={() => {
              archive.run({ entityId, knowledgeFileId: file.id }, onArchived);
            }}
          >
            {t('archive')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
