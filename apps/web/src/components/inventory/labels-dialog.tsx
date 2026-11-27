'use client';

import type { LabelSheetDto, PrintableLabelKind } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Textarea,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { printLabels, reprintLabels } from '../../actions/labels';
import { useOpenFile } from '../files/use-open-file';
import { waitForFile } from '../files/wait-for-file';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

type Stage =
  | { kind: 'ask' }
  | { kind: 'printing'; sheet: LabelSheetDto }
  | { kind: 'ready'; sheet: LabelSheetDto }
  | { kind: 'slow'; sheet: LabelSheetDto };

/**
 * Print labels, or print them again with why (Q1, docs/03-roadmap-appendix/phase3.md §7.4): the
 * render worker prints the sheet at the label stock's size (in this process when no queue is
 * configured, so it is often ready at once), and the dialog waits for its file, then offers to
 * open it for the hub's label printer. A reprint asks why first; the reason is kept with each
 * label in the Activity log.
 */
export function LabelsDialog({
  mode,
  entityId,
  labelKind,
  ids,
  title,
  intro,
  returnFocusTo,
  onClose,
}: {
  mode: 'print' | 'reprint';
  entityId: number;
  labelKind: PrintableLabelKind;
  ids: readonly string[];
  title: string;
  intro: string;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
}) {
  const t = useTranslations('inventory.labels');
  const common = useTranslations('common');
  const print = useCommand(printLabels);
  const reprint = useCommand(reprintLabels);
  const { run, pending, failure } = mode === 'print' ? print : reprint;
  const { fieldError, formFailure } = useFieldFailure(failure, ['note']);
  const { open: openSheet, opening, failure: openFailure } = useOpenFile();
  const [stage, setStage] = useState<Stage>({ kind: 'ask' });
  const [problem, setProblem] = useState(false);
  const open = useRef(true);

  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  function printed(sheet: LabelSheetDto) {
    setStage({ kind: 'printing', sheet });
    void waitForFile(sheet.sheetId, () => open.current).then((outcome) => {
      if (open.current) setStage({ kind: outcome, sheet });
    });
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || stage.kind !== 'ask') return;
    if (mode === 'print') {
      run({ entityId, labelKind, ids: [...ids] }, printed);
      return;
    }
    const note = formText(new FormData(e.currentTarget), 'note');
    if (note.length < 3 || note.length > 300) {
      setProblem(true);
      return;
    }
    setProblem(false);
    run({ entityId, labelKind, ids: [...ids], note }, printed);
  }

  const status =
    stage.kind === 'ask'
      ? undefined
      : {
          printing: t('working', { count: stage.sheet.count }),
          ready: t('ready', { count: stage.sheet.count }),
          slow: t('slow'),
        }[stage.kind];

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{intro}</DialogDescription>
          </DialogHeader>
          {mode === 'reprint' ? (
            <Field
              id="label-note"
              label={t('note')}
              helper={t('noteHelper')}
              error={problem ? t('noteInvalid') : fieldError('note')}
            >
              <Textarea
                name="note"
                rows={3}
                maxLength={300}
                readOnly={stage.kind !== 'ask'}
                aria-readonly={stage.kind !== 'ask'}
              />
            </Field>
          ) : null}
          <p className="text-sm" role="status" aria-live="polite">
            {status}
          </p>
          <FailureMessage failure={formFailure} />
          <FailureMessage failure={openFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {stage.kind === 'ask' ? common('cancel') : common('close')}
            </Button>
            {stage.kind === 'ask' ? (
              <Button type="submit" pending={pending}>
                {mode === 'print' ? t('printSubmit') : t('reprintSubmit')}
              </Button>
            ) : stage.kind === 'ready' ? (
              <Button
                pending={opening}
                onClick={() => {
                  openSheet(stage.sheet.sheetId);
                }}
              >
                {t('openLabels')}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
