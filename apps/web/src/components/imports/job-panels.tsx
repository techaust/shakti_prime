'use client';

import type { ImportJobDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  commitImportJob,
  getImportJob,
  previewImportJob,
  rollbackImportJob,
} from '../../actions/imports';
import {
  canRollBack,
  commitProgress,
  failedBatchRange,
  formatCount,
  isStalled,
} from '../../screens/import-wizard';
import { FailureMessage } from '../screens/failure';
import { useCommand, type CommandFailure } from '../screens/use-command';
import { checkProgress } from './progress-check';

/** How often the screen asks how far adding has come. */
const POLL_MS = 3000;

function Panel({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      className="border-border bg-surface flex flex-col gap-4 rounded-lg border p-4 sm:p-6"
      aria-labelledby="import-step-title"
    >
      <div className="flex flex-col gap-1">
        <h2 id="import-step-title" className="text-h2">
          {title}
        </h2>
        {intro === undefined ? null : <p className="text-text-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

/** The job's counts as tiles: rows in the file, ready, to correct, repeated and added. */
function Counts({ job, added = false }: { job: ImportJobDto; added?: boolean }) {
  const t = useTranslations('imports.check.counts');
  const tiles: { key: 'total' | 'valid' | 'invalid' | 'skipped' | 'committed'; value: number }[] = [
    { key: 'total', value: job.totalRows },
    { key: 'valid', value: job.validRows },
    { key: 'invalid', value: job.invalidRows },
    { key: 'skipped', value: job.skippedRows },
  ];
  if (added) tiles.push({ key: 'committed', value: job.committedRows });
  return (
    <dl aria-label={t('label')} className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
      {tiles.map((tile) => (
        <div key={tile.key} className="bg-surface-2 flex flex-col gap-1 rounded-md px-3 py-2">
          <dt className="text-text-muted text-xs">{t(tile.key)}</dt>
          <dd className="text-h3 tabular-nums">{formatCount(tile.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      {children}
    </div>
  );
}

/** Matched but not yet checked, as when checking the rows failed: check them now. */
export function CheckPanel({
  job,
  refreshing,
  onRemap,
  onDone,
}: {
  job: ImportJobDto;
  refreshing: boolean;
  onRemap: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('imports.check');
  const { run, pending, failure } = useCommand(previewImportJob);
  return (
    <Panel title={t('title')} intro={t('mappedIntro')}>
      <FailureMessage failure={failure} />
      <Actions>
        <Button variant="secondary" onClick={onRemap}>
          {t('remap')}
        </Button>
        <Button
          pending={pending || refreshing}
          onClick={() => {
            run({ entityId: job.entityId, jobId: job.id }, onDone);
          }}
        >
          {t('check')}
        </Button>
      </Actions>
    </Panel>
  );
}

/** Step three: the counts, and adding the ready rows; or matching the columns again. */
export function CommitPanel({
  job,
  refreshing,
  onRemap,
  onDone,
}: {
  job: ImportJobDto;
  refreshing: boolean;
  onRemap: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('imports.check');
  const errors = useTranslations('errors');
  const { run, pending, failure } = useCommand(commitImportJob);
  const left = job.invalidRows + job.skippedRows;
  return (
    <Panel title={t('title')} intro={t('intro')}>
      <Counts job={job} />
      {job.validRows === 0 ? (
        <p className="text-danger text-sm">{errors('import_nothing_to_commit')}</p>
      ) : left > 0 ? (
        <p className="text-text-muted text-sm">
          {t('commitHelper', { count: left, shown: formatCount(left) })}
        </p>
      ) : null}
      <FailureMessage failure={failure} />
      <Actions>
        <Button variant="secondary" onClick={onRemap}>
          {t('remap')}
        </Button>
        {job.validRows === 0 ? null : (
          <Button
            pending={pending || refreshing}
            onClick={() => {
              run({ entityId: job.entityId, jobId: job.id }, onDone);
            }}
          >
            {t('commit', { count: job.validRows, shown: formatCount(job.validRows) })}
          </Button>
        )}
      </Actions>
    </Panel>
  );
}

/** How far adding has come, as a bar and in words; read from the page's own role. */
function Progress({ job }: { job: ImportJobDto }) {
  const t = useTranslations('imports.progress');
  const { done, total, percent } = commitProgress(job);
  const words = t('count', { done: formatCount(done), total: formatCount(total) });
  return (
    <div className="flex flex-col gap-2">
      <div
        role="progressbar"
        aria-label={t('label')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={words}
        className="bg-surface-2 h-2 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-accent h-full rounded-full transition-[width] duration-(--motion-panel) ease-out"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <p aria-live="polite" className="text-sm tabular-nums">
        {words}
      </p>
    </div>
  );
}

/**
 * Step four while rows are going in: the progress, asked for every few seconds until the job is
 * added or stops. When nothing moves for longer than a batch takes, the person may carry on,
 * which starts the worker again without changing anything else.
 */
export function ProgressPanel({
  job,
  refreshing,
  onChanged,
}: {
  job: ImportJobDto;
  refreshing: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('imports.progress');
  const [current, setCurrent] = useState(job);
  const [stalled, setStalled] = useState(false);
  // When the rows added last changed; set when the first check starts, not while rendering.
  const lastChange = useRef<{ rows: number; at: number } | undefined>(undefined);
  const resume = useCommand(commitImportJob);
  // A check that failed or never answered: shown, and the checks stop until the page is read again.
  const [checkFailure, setCheckFailure] = useState<CommandFailure | undefined>();

  useEffect(() => {
    let stopped = false;
    lastChange.current ??= { rows: job.committedRows, at: Date.now() };
    const timer = window.setInterval(() => {
      void checkProgress(() => getImportJob({ entityId: job.entityId, jobId: job.id })).then(
        (check) => {
          if (stopped) return;
          if (check.kind !== 'moving') {
            stopped = true;
            window.clearInterval(timer);
            if (check.kind === 'finished') {
              onChanged();
              return;
            }
            setCheckFailure((previous) => ({
              error: check.error,
              reference: check.reference,
              attempt: (previous?.attempt ?? 0) + 1,
            }));
            return;
          }
          const next = check.job;
          const now = Date.now();
          const last = lastChange.current ?? { rows: next.committedRows, at: now };
          lastChange.current =
            next.committedRows === last.rows ? last : { rows: next.committedRows, at: now };
          setCurrent(next);
          setStalled(isStalled(lastChange.current.at, now));
        },
      );
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [job.entityId, job.id, job.committedRows, onChanged]);

  return (
    <Panel title={t('title')} intro={t('intro')}>
      <Progress job={current} />
      <FailureMessage failure={checkFailure} />
      {stalled ? (
        <>
          <p className="text-text-muted text-sm">{t('stalled')}</p>
          <FailureMessage failure={resume.failure} />
          <Actions>
            <Button
              pending={resume.pending || refreshing}
              onClick={() => {
                resume.run({ entityId: job.entityId, jobId: job.id }, (next) => {
                  lastChange.current = { rows: next.committedRows, at: Date.now() };
                  setStalled(false);
                  onChanged();
                });
              }}
            >
              {t('resume')}
            </Button>
          </Actions>
        </>
      ) : null}
    </Panel>
  );
}

/** A finished job: added, stopped part way, or undone; with the undo where it is allowed. */
export function OutcomePanel({
  job,
  batchSize,
  onDone,
}: {
  job: ImportJobDto;
  batchSize: number;
  onDone: () => void;
}) {
  const t = useTranslations('imports');
  const [confirming, setConfirming] = useState(false);
  const { done, total } = commitProgress(job);

  const title =
    job.state === 'failed'
      ? t('failed.title')
      : job.state === 'rolled_back'
        ? t('done.rolledBackTitle')
        : t('done.title');
  const intro =
    job.state === 'failed' ? (
      <>
        {t('failed.intro', {
          done: formatCount(done),
          total: formatCount(total),
          ...rangeWords(failedBatchRange(job.failedBatch ?? 1, batchSize)),
        })}{' '}
        {t('failed.next')}
      </>
    ) : job.state === 'rolled_back' ? (
      t('done.rolledBackIntro')
    ) : (
      t('done.intro', { count: job.committedRows, shown: formatCount(job.committedRows) })
    );

  return (
    <Panel title={title} intro={intro}>
      {job.state === 'failed' ? <Progress job={job} /> : <Counts job={job} added />}
      <Actions>
        {canRollBack(job.state) ? (
          <Button
            variant="danger"
            onClick={() => {
              setConfirming(true);
            }}
          >
            {t('done.rollback')}
          </Button>
        ) : null}
        <Button variant="secondary" asChild>
          <Link href="/imports/new">{t('done.another')}</Link>
        </Button>
        {job.state === 'committed' ? (
          <Button asChild>
            <Link href="/leads">{t('done.viewLeads')}</Link>
          </Button>
        ) : null}
      </Actions>
      <RollbackDialog
        job={job}
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        onDone={onDone}
      />
    </Panel>
  );
}

function rangeWords(range: { from: number; to: number }) {
  return { from: formatCount(range.from), to: formatCount(range.to) };
}

/**
 * The undo, confirmed in a dialog that says what it archives: every lead the file added, newest
 * row first. Customers stay, because other leads may belong to them (ADR 0008). The dialog's form
 * is rendered afresh each time it opens, which gives it a new idempotency key.
 */
function RollbackDialog({
  job,
  open,
  onClose,
  onDone,
}: {
  job: ImportJobDto;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const common = useTranslations('common');
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      {open ? (
        <DialogContent closeLabel={common('close')}>
          <RollbackForm job={job} onCancel={onClose} onDone={onDone} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function RollbackForm({
  job,
  onCancel,
  onDone,
}: {
  job: ImportJobDto;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('imports.rollbackDialog');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(rollbackImportJob);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    run({ entityId: job.entityId, jobId: job.id }, () => {
      toast.success(t('done', { file: job.file.name }));
      onCancel();
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>
          {t('intro', { count: job.committedRows, shown: formatCount(job.committedRows) })}
        </DialogDescription>
      </DialogHeader>
      <FailureMessage failure={failure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" variant="danger" pending={pending}>
          {t('submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
