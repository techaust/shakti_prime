'use client';

import type { FileDto, FilePurpose, FilePresignResponse } from '@shakti/contracts';
import type { UploadControls, UploadResult } from '@shakti/ui';
import { percentOf } from '@shakti/ui';
import { fileStatus, finishUpload, startUpload } from '../../actions/files';
import type { ActionResult } from '../../actions/result';
import type { ErrorKey } from '../../i18n/types';
import { settle } from '../screens/settle';

/** How long the uploader waits for the checks before saying they will finish on their own. */
export const CHECK_WAIT_MS = 30_000;
const POLL_MS = 1_500;

/** The sentences an upload may end with, from the message catalogue. */
export interface SendFileText {
  checking: string;
  checkingLong: string;
  ready: string;
  failed: string;
  error: (key: ErrorKey) => string;
}

/** Failures the person can fix by trying again, as opposed to a file the checks refused. */
const RETRYABLE: ReadonlySet<string> = new Set([
  'internal',
  'integration_unavailable',
  'conflict',
  'rate_limited',
  'file_upload_mismatch',
]);

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The browser's forbidden headers are sent by the browser itself; the rest go as signed. */
const BROWSER_SET = new Set(['content-length', 'host']);

/** Sends the bytes to the signed address, reporting progress; resolves false if it failed. */
function put(
  file: File,
  slot: FilePresignResponse,
  controls: UploadControls,
): Promise<'sent' | 'failed' | 'aborted'> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(slot.method, slot.uploadUrl);
    for (const [name, value] of Object.entries(slot.headers)) {
      if (!BROWSER_SET.has(name.toLowerCase())) xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) controls.onProgress(percentOf(e.loaded, e.total));
    };
    xhr.onload = () => {
      resolve(xhr.status >= 200 && xhr.status < 300 ? 'sent' : 'failed');
    };
    xhr.onerror = () => {
      resolve('failed');
    };
    xhr.onabort = () => {
      resolve('aborted');
    };
    controls.signal.addEventListener('abort', () => {
      xhr.abort();
    });
    xhr.send(file);
  });
}

function failedWith<T>(result: Extract<ActionResult<T>, { ok: false }>, text: SendFileText) {
  return {
    status: 'failed' as const,
    message: text.error(result.error),
    canRetry: RETRYABLE.has(result.error),
  };
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * One upload from a screen (docs/ARCHITECTURE.md §9): the file's SHA-256 is worked out here, the
 * server records the file and signs an address for exactly these bytes, the browser sends them
 * there with progress, the server checks what landed, and the screen waits a while for the checks
 * to pass. Each attempt carries its own idempotency keys.
 */
export async function sendFile(
  file: File,
  target: { entityId: number; purpose: FilePurpose },
  controls: UploadControls,
  text: SendFileText,
): Promise<UploadResult> {
  const sha256 = await sha256Hex(file);
  if (controls.signal.aborted) return { status: 'failed', message: '', canRetry: true };
  const slot = await settle(() =>
    startUpload(
      {
        entityId: target.entityId,
        purpose: target.purpose,
        name: file.name,
        contentType: file.type,
        size: file.size,
        sha256,
      },
      crypto.randomUUID(),
    ),
  );
  if (!slot.ok) return failedWith(slot, text);

  const sent = await put(file, slot.data, controls);
  if (sent !== 'sent') return { status: 'failed', message: text.failed, canRetry: true };
  controls.onProgress(100);

  const done = await settle(() =>
    finishUpload({ fileId: slot.data.fileId, purpose: target.purpose }, crypto.randomUUID()),
  );
  if (!done.ok) return failedWith(done, text);
  controls.onWaiting(text.checking);
  return waitForChecks(done.data, controls.signal, text);
}

async function waitForChecks(
  file: FileDto,
  signal: AbortSignal,
  text: SendFileText,
): Promise<UploadResult> {
  const started = Date.now();
  let current = file;
  while (Date.now() - started < CHECK_WAIT_MS && !signal.aborted) {
    if (current.status === 'ready') return { status: 'done', message: text.ready };
    if (current.status === 'rejected') {
      return {
        status: 'failed',
        message: text.error(current.rejectReason ?? 'file_unreadable'),
        canRetry: false,
      };
    }
    await pause(POLL_MS, signal);
    const read = await settle(() => fileStatus(current.id));
    if (read.ok) current = read.data;
  }
  return { status: 'waiting', message: text.checkingLong };
}
