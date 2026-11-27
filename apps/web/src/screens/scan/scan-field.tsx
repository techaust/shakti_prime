'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  type ReturnFocusTo,
} from '@shakti/ui';
import { Camera, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { scanOnce, type ScanOutcome, type ScanResolve } from './scan-state';

/**
 * The scan field (docs/03-roadmap-appendix/phase3.md §7.2, question 8 (a)): one input that takes a
 * handheld scanner's keystrokes (the scanner types the code and presses Enter) or the camera's
 * reading, says at once whether a code is taken, known, a repeat or the wrong shape, and keeps the
 * count. What a code means is the screen's: it passes `resolve`. The camera uses the browser's own
 * barcode reader where it has one (Chrome on Android reads QR and the usual one-dimensional codes),
 * else the installed `jsqr`, which reads QR codes only; nothing else is installed for it.
 */
export function ScanField({
  id,
  label,
  helper,
  codes,
  onCodesChange,
  resolve,
  expected,
  error,
  disabled = false,
}: {
  id: string;
  label: string;
  helper?: string;
  /** The codes taken so far, in the order scanned. */
  codes: readonly string[];
  onCodesChange: (codes: string[]) => void;
  resolve: ScanResolve;
  /** How many codes the screen expects; the field refuses more and counts towards it. */
  expected?: number;
  error?: string | undefined;
  disabled?: boolean;
}) {
  const t = useTranslations('scan');
  const [typed, setTyped] = useState('');
  const [outcome, setOutcome] = useState<ScanOutcome | undefined>();
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cameraButton = useRef<HTMLButtonElement>(null);
  // The codes as last handed back, so a fast scanner's second code builds on the first.
  const latest = useRef<readonly string[]>(codes);
  latest.current = codes;

  async function take(raw: string) {
    const result = await scanOnce(latest.current, raw, resolve, expected);
    latest.current = result.codes;
    if (result.codes.length !== codes.length || result.outcome.kind === 'taken') {
      onCodesChange(result.codes);
    }
    setOutcome(result.outcome);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = typed;
    setTyped('');
    void take(raw);
  }

  function remove(code: string) {
    onCodesChange(codes.filter((c) => c !== code));
    setOutcome(undefined);
    input.current?.focus();
  }

  const count =
    expected === undefined
      ? t('countOpen', { count: codes.length })
      : t('count', { count: codes.length, expected });

  return (
    <div className="flex flex-col gap-2">
      <Field
        id={id}
        label={label}
        helper={helper}
        error={error}
        actions={
          <Button
            ref={cameraButton}
            variant="secondary"
            onClick={() => setCamera(true)}
            disabled={disabled}
            aria-label={t('camera')}
          >
            <Camera aria-hidden className="size-4" />
            <span className="max-sm:sr-only">{t('camera')}</span>
          </Button>
        }
      >
        <Input
          ref={input}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={t('placeholder')}
          disabled={disabled}
        />
      </Field>
      <p className="text-text-muted text-sm" aria-live="polite">
        <span className="font-medium">{count}</span>
        {outcome === undefined || outcome.kind === 'empty' ? null : (
          <span className={outcome.kind === 'taken' ? 'text-success' : 'text-danger'}>
            {' · '}
            {outcomeText(outcome, t)}
          </span>
        )}
      </p>
      {codes.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2" aria-label={t('scanned')}>
          {codes.map((code) => (
            <li
              key={code}
              className="bg-surface-2 text-text flex items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2 font-mono text-sm"
            >
              {code}
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => remove(code)}
                aria-label={t('remove', { code })}
                disabled={disabled}
              >
                <X aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {camera ? (
        <CameraDialog
          returnFocusTo={() => [cameraButton.current, input.current]}
          onClose={() => setCamera(false)}
          onCode={(code) => void take(code)}
        />
      ) : null}
    </div>
  );
}

function outcomeText(
  outcome: Exclude<ScanOutcome, { kind: 'empty' }>,
  t: ReturnType<typeof useTranslations<'scan'>>,
): string {
  switch (outcome.kind) {
    case 'taken':
      return outcome.known
        ? t('known', { code: outcome.label ?? outcome.code })
        : t('taken', { code: outcome.code });
    case 'repeat':
      return t('repeat', { code: outcome.code });
    case 'unknown':
      return t('unknown', { code: outcome.code });
    case 'wrong_pattern':
      return t('wrongPattern', { code: outcome.code });
    case 'full':
      return t('full');
  }
}

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeReader {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeReaderClass = new (options?: { formats?: string[] }) => BarcodeReader;

/** The browser's own barcode reader, where it has one. */
function browserReader(): BarcodeReader | undefined {
  const Reader = (globalThis as { BarcodeDetector?: BarcodeReaderClass }).BarcodeDetector;
  return Reader === undefined ? undefined : new Reader();
}

const FRAME_MS = 250;

/**
 * The camera, read a frame at a time until a code is found; the dialog stays open for the next
 * one, so a box of serials is read without reopening it.
 */
function CameraDialog({
  returnFocusTo,
  onClose,
  onCode,
}: {
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onCode: (code: string) => void;
}) {
  const t = useTranslations('scan');
  const common = useTranslations('common');
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<'denied' | 'none' | undefined>();
  const [qrOnly, setQrOnly] = useState(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    let last = '';
    const canvas = document.createElement('canvas');

    async function start() {
      if (navigator.mediaDevices?.getUserMedia === undefined) {
        setProblem('none');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch {
        setProblem('denied');
        return;
      }
      if (stopped || video.current === null) return;
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      const reader = browserReader();
      setQrOnly(reader === undefined);
      const jsqr = reader === undefined ? (await import('jsqr')).default : undefined;
      timer = setInterval(() => {
        const v = video.current;
        if (v === null || v.videoWidth === 0) return;
        void (async () => {
          let code: string | undefined;
          if (reader !== undefined) {
            const found = await reader.detect(v).catch(() => []);
            code = found[0]?.rawValue;
          } else if (jsqr !== undefined) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (context === null) return;
            context.drawImage(v, 0, 0);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            code = jsqr(image.data, image.width, image.height)?.data;
          }
          if (code !== undefined && code !== '' && code !== last) {
            last = code;
            onCodeRef.current(code);
          }
        })();
      }, FRAME_MS);
    }
    void start();
    return () => {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, []);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <DialogHeader>
          <DialogTitle>{t('cameraTitle')}</DialogTitle>
          <DialogDescription>{qrOnly ? t('cameraQrOnly') : t('cameraIntro')}</DialogDescription>
        </DialogHeader>
        {problem === undefined ? (
          <video
            ref={video}
            muted
            playsInline
            className="bg-surface-2 aspect-video w-full rounded-md object-cover"
          />
        ) : (
          <p role="alert" className="text-danger text-sm">
            {problem === 'denied' ? t('cameraDenied') : t('cameraNone')}
          </p>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t('closeCamera')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
