'use client';

import { CircleAlert, CircleCheck, Upload } from 'lucide-react';
import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';

/** Where one upload stands; every sentence in it comes from the caller's catalogue. */
export type UploaderPhase =
  | { kind: 'idle' }
  /** The file was refused before any byte was sent (its type, size or emptiness). */
  | { kind: 'refused'; message: string }
  | { kind: 'uploading'; fileName: string; percent: number }
  /** The bytes landed and the file waits for its checks. */
  | { kind: 'waiting'; fileName: string; message: string }
  | { kind: 'done'; fileName: string; message: string }
  | { kind: 'failed'; fileName: string; message: string; canRetry: boolean }
  | { kind: 'cancelled'; message: string };

/** The words the uploader shows, from the app's message catalogue. */
export interface UploaderText {
  choose: string;
  drop: string;
  cancel: string;
  retry: string;
  /** Announced when the bytes start going; the progress bar carries each percent. */
  started: string;
  /** Announced once, when half the bytes have gone. */
  halfway: string;
  cancelled: string;
  /** The catalogue's general failure, for an upload that failed without saying why. */
  failed: string;
  wrongType: string;
  tooLarge: string;
  empty: string;
}

/** How an upload ended, in the caller's words. */
export type UploadResult =
  | { status: 'done' | 'waiting'; message: string }
  | { status: 'failed'; message: string; canRetry: boolean };

export interface UploadControls {
  /** Whole percent of the bytes sent. */
  onProgress: (percent: number) => void;
  /** The bytes landed; the file now waits for its checks. */
  onWaiting: (message: string) => void;
  signal: AbortSignal;
}

/** What is wrong with a picked file before it is sent, or undefined when it may go. */
export function pickProblem(
  file: { type: string; size: number },
  accept: readonly string[],
  maxBytes: number,
): 'wrongType' | 'tooLarge' | 'empty' | undefined {
  if (!accept.includes(file.type)) return 'wrongType';
  if (file.size === 0) return 'empty';
  return file.size > maxBytes ? 'tooLarge' : undefined;
}

/** Bytes sent as a whole percent, never 100 before the last byte. */
export function percentOf(loaded: number, total: number): number {
  if (total <= 0) return 0;
  if (loaded >= total) return 100;
  return Math.min(99, Math.floor((loaded / total) * 100));
}

/**
 * Where an upload stands once `upload` has answered: cancelled when it was cancelled, the
 * caller's outcome otherwise, and the general failure sentence when it threw or failed without
 * saying why (`result` undefined for a throw).
 */
export function phaseAfter(
  fileName: string,
  result: UploadResult | undefined,
  cancelled: boolean,
  text: Pick<UploaderText, 'cancelled' | 'failed'>,
): UploaderPhase {
  if (cancelled) return { kind: 'cancelled', message: text.cancelled };
  if (result === undefined) {
    return { kind: 'failed', fileName, message: text.failed, canRetry: true };
  }
  if (result.status === 'failed') {
    const message = result.message === '' ? text.failed : result.message;
    return { kind: 'failed', fileName, message, canRetry: result.canRetry };
  }
  return { kind: result.status, fileName, message: result.message };
}

export interface UploaderViewProps {
  id: string;
  label: string;
  hint?: ReactNode;
  accept: readonly string[];
  phase: UploaderPhase;
  text: UploaderText;
  disabled?: boolean;
  dragging?: boolean;
  onPick: (file: File) => void;
  onCancel: () => void;
  onRetry: () => void;
  onDragChange?: (dragging: boolean) => void;
}

/**
 * The uploader as it looks in a phase (DESIGN.md §6): a labelled file control with a drop area,
 * the limits under it, a progress bar while sending, and the outcome in words in a live region,
 * so a screen reader hears each change. Cancel while sending, retry after a failure.
 */
export function UploaderView({
  id,
  label,
  hint,
  accept,
  phase,
  text,
  disabled = false,
  dragging = false,
  onPick,
  onCancel,
  onRetry,
  onDragChange,
}: UploaderViewProps) {
  const input = useRef<HTMLInputElement>(null);
  const busy = phase.kind === 'uploading';
  const statusId = `${id}-status`;
  const hintId = `${id}-hint`;
  const labelId = `${id}-label`;
  const chooseId = `${id}-choose`;
  const describedBy = [hint === undefined ? undefined : hintId, statusId].filter(Boolean).join(' ');

  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    onDragChange?.(false);
    const file = e.dataTransfer.files[0];
    if (file !== undefined && !busy && !disabled) onPick(file);
  };

  let status: ReactNode = null;
  let tone: 'muted' | 'success' | 'danger' = 'muted';
  switch (phase.kind) {
    case 'refused':
    case 'cancelled':
      status = phase.message;
      tone = phase.kind === 'refused' ? 'danger' : 'muted';
      break;
    case 'uploading':
      // Only the milestones are announced; the progress bar carries the value in between.
      status = phase.percent >= 50 ? text.halfway : text.started;
      break;
    case 'waiting':
      status = phase.message;
      break;
    case 'done':
      status = phase.message;
      tone = 'success';
      break;
    case 'failed':
      status = phase.message;
      tone = 'danger';
      break;
    case 'idle':
      break;
  }

  return (
    <div className="flex flex-col gap-2">
      <label id={labelId} htmlFor={id} className="text-text-muted text-sm font-medium">
        {label}
      </label>
      <div
        data-dragging={dragging ? 'true' : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy && !disabled) onDragChange?.(true);
        }}
        onDragLeave={() => onDragChange?.(false)}
        onDrop={drop}
        className={cn(
          'border-border-strong flex flex-wrap items-center gap-3 rounded-md border border-dashed p-4',
          'data-[dragging=true]:border-accent data-[dragging=true]:bg-highlight',
        )}
      >
        <input
          ref={input}
          id={id}
          type="file"
          className="sr-only"
          // The button below is the control a keyboard reaches; this input only opens the picker.
          tabIndex={-1}
          accept={accept.join(',')}
          disabled={disabled || busy}
          aria-describedby={describedBy}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            // Cleared, so choosing the same file again after a failure still fires.
            e.currentTarget.value = '';
            if (file !== undefined) onPick(file);
          }}
        />
        <Button
          variant="secondary"
          disabled={disabled || busy}
          aria-controls={id}
          aria-labelledby={`${labelId} ${chooseId}`}
          aria-describedby={describedBy}
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden />
          <span id={chooseId}>{text.choose}</span>
        </Button>
        <span className="text-text-muted text-sm">{text.drop}</span>
      </div>
      {hint === undefined ? null : (
        <p id={hintId} className="text-text-muted text-sm">
          {hint}
        </p>
      )}
      {phase.kind === 'uploading' ? (
        <div
          role="progressbar"
          aria-labelledby={labelId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={phase.percent}
          className="bg-surface-sunken h-2 w-full overflow-hidden rounded-full"
        >
          <div className="bg-accent h-full" style={{ width: `${String(phase.percent)}%` }} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          className={cn(
            'flex items-center gap-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0',
            tone === 'muted' && 'text-text-muted',
            tone === 'success' && 'text-success',
            tone === 'danger' && 'text-danger',
          )}
        >
          {tone === 'success' ? <CircleCheck aria-hidden /> : null}
          {tone === 'danger' ? <CircleAlert aria-hidden /> : null}
          {status}
        </p>
        {phase.kind === 'uploading' ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {text.cancel}
          </Button>
        ) : null}
        {phase.kind === 'failed' && phase.canRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {text.retry}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export interface UploaderProps {
  id: string;
  label: string;
  hint?: ReactNode;
  /** The content types the purpose takes; a file of another type is refused before sending. */
  accept: readonly string[];
  maxBytes: number;
  text: UploaderText;
  disabled?: boolean;
  /** Sends the file: records it, puts the bytes, waits for the checks. Must honour `signal`. */
  upload: (file: File, controls: UploadControls) => Promise<UploadResult>;
  /** Called when an upload ends as `done` or `waiting`. */
  onUploaded?: (result: UploadResult) => void;
}

/** Picks, checks and sends one file at a time; see `UploaderView` for what it shows. */
export function Uploader({
  id,
  label,
  hint,
  accept,
  maxBytes,
  text,
  disabled,
  upload,
  onUploaded,
}: UploaderProps) {
  const [phase, setPhase] = useState<UploaderPhase>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const last = useRef<File | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);

  const send = useCallback(
    async (file: File) => {
      const controller = new AbortController();
      abort.current = controller;
      setPhase({ kind: 'uploading', fileName: file.name, percent: 0 });
      let result: UploadResult | undefined;
      try {
        result = await upload(file, {
          signal: controller.signal,
          onProgress: (percent) => {
            if (!controller.signal.aborted) {
              setPhase({ kind: 'uploading', fileName: file.name, percent });
            }
          },
          onWaiting: (message) => {
            if (!controller.signal.aborted) {
              setPhase({ kind: 'waiting', fileName: file.name, message });
            }
          },
        });
      } catch {
        result = undefined;
      }
      setPhase(phaseAfter(file.name, result, controller.signal.aborted, text));
      if (!controller.signal.aborted && result !== undefined && result.status !== 'failed') {
        onUploaded?.(result);
      }
    },
    [upload, onUploaded, text],
  );

  const pick = (file: File) => {
    const problem = pickProblem(file, accept, maxBytes);
    if (problem !== undefined) {
      setPhase({ kind: 'refused', message: text[problem] });
      return;
    }
    last.current = file;
    void send(file);
  };

  return (
    <UploaderView
      id={id}
      label={label}
      hint={hint}
      accept={accept}
      phase={phase}
      text={text}
      disabled={disabled ?? false}
      dragging={dragging}
      onDragChange={setDragging}
      onPick={pick}
      onCancel={() => abort.current?.abort()}
      onRetry={() => {
        if (last.current !== undefined) void send(last.current);
      }}
    />
  );
}
