'use client';

import type { EntityDto, PrintProofDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { fileStatus } from '../../actions/files';
import { requestPrintProof } from '../../actions/org';
import { useOpenFile } from '../files/use-open-file';
import { FailureMessage } from '../screens/failure';
import { settle } from '../screens/settle';
import { useCommand } from '../screens/use-command';

/** How often the dialog asks whether the proof page is printed, and for how long. */
const POLL_MS = 2_000;
const POLL_LIMIT_MS = 90_000;

type Stage = { kind: 'printing' } | { kind: 'ready'; fileId: string } | { kind: 'slow' };

/**
 * Settings › Companies: an Executive prints a company's proof page (docs/03-roadmap-appendix/phase1.md §6.4),
 * loaded on demand by the companies screen. Opening the dialog asks for the page once; the render
 * worker prints it (in this process when no queue is configured, so it is often ready at once),
 * and the dialog waits for its file, then offers to open it.
 */
export function ProofDialog({
  company,
  closeLabel,
  returnFocusTo,
  onClose,
}: {
  company: EntityDto;
  closeLabel: string;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
}) {
  const t = useTranslations('companies');
  const common = useTranslations('common');
  const { run, failure } = useCommand(requestPrintProof);
  const { open: openProof, opening, failure: openFailure } = useOpenFile();
  const [stage, setStage] = useState<Stage>({ kind: 'printing' });
  const asked = useRef(false);
  const open = useRef(true);

  useEffect(() => {
    open.current = true;
    // Once per dialog; the form's own key makes a repeated call print one page.
    if (!asked.current) {
      asked.current = true;
      run({ entityId: company.id }, (proof: PrintProofDto) => {
        void waitForFile(proof.proofId, () => open.current).then(setStage);
      });
    }
    return () => {
      open.current = false;
    };
  }, [company.id, run]);

  const status =
    failure !== undefined
      ? undefined
      : {
          printing: t('proofWorking'),
          ready: t('proofReady'),
          slow: t('proofSlow'),
        }[stage.kind];

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent closeLabel={closeLabel} returnFocusTo={returnFocusTo}>
        <DialogHeader>
          <DialogTitle>{t('proofTitle', { name: company.legalName })}</DialogTitle>
          <DialogDescription>{t('proofIntro')}</DialogDescription>
        </DialogHeader>
        <p className="text-sm" role="status" aria-live="polite">
          {status}
        </p>
        <FailureMessage failure={failure} />
        <FailureMessage failure={openFailure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {common('close')}
          </Button>
          {stage.kind === 'ready' ? (
            <Button
              pending={opening}
              onClick={() => {
                openProof(stage.fileId);
              }}
            >
              {t('openProof')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Asks for the proof's file until it is ready (`ready`, with its id), or `slow` when it has not
 * come within the limit: a page the worker could not print waits as a held update on Integration
 * health, and the person can close the dialog and try again. It stops asking once the dialog is
 * closed.
 */
async function waitForFile(fileId: string, stillOpen: () => boolean): Promise<Stage> {
  const started = Date.now();
  for (;;) {
    if (!stillOpen()) return { kind: 'slow' };
    const result = await settle(() => fileStatus(fileId));
    if (result.ok && result.data.status === 'ready') return { kind: 'ready', fileId };
    if (Date.now() - started >= POLL_LIMIT_MS) return { kind: 'slow' };
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
