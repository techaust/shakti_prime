'use client';

import type { KnowledgeFileDetailDto } from '@shakti/contracts';
import { Button, Field, StatusBadge, Textarea, type StatusTone } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { correctKnowledgeTranscript, recheckKnowledgeFile } from '../../actions/knowledge';
import { formatDate } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';

/** How often the file is read again while it is being transcribed and read. */
const REFRESH_MS = 4_000;
/** The longest transcript a person may save (`KNOWLEDGE_TRANSCRIPT_MAX_CHARS`). */
const TRANSCRIPT_MAX = 100_000;

const STATE_TONE: Readonly<Record<KnowledgeFileDetailDto['state'], StatusTone>> = {
  waiting: 'info',
  indexed: 'success',
  failed: 'danger',
  unavailable: 'warning',
  archived: 'neutral',
};

/** The states in which a recording's transcript may be corrected: never while it is being read. */
const CORRECTABLE: ReadonlySet<KnowledgeFileDetailDto['state']> = new Set([
  'indexed',
  'failed',
  'unavailable',
]);

/**
 * A vault file's page (K3): its company, who can find it, its kind and where it stands, with the
 * reason a file could not be read; for a recording, the player beside its transcript, which a
 * holder of `knowledge.vault.write` corrects and saves, reading the file again from it. The file is
 * read again while it is being transcribed and read.
 */
export function KnowledgeFileScreen({
  initial,
  company,
  entityId,
  canCorrect,
  audioUrl,
}: {
  initial: KnowledgeFileDetailDto;
  /** The company's name; undefined for a file of every company. */
  company: string | undefined;
  /** The company the request acts for when the transcript is saved. */
  entityId: number;
  canCorrect: boolean;
  /** The recording's short-lived address; undefined when it cannot be played here. */
  audioUrl?: string;
}) {
  const t = useTranslations('knowledge');
  const errors = useTranslations('errors');
  const [file, setFile] = useState(initial);
  const read = useQuery<KnowledgeFileDetailDto>();
  const reload = read.load;
  const waiting = file.state === 'waiting';

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      reload(() => recheckKnowledgeFile(file.id), setFile);
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [waiting, reload, file.id]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section
        aria-labelledby="knowledge-file-about"
        className="border-border bg-surface flex flex-col gap-3 rounded-md border p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="knowledge-file-about" className="text-h3">
            {t('file.about')}
          </h2>
          <span aria-live="polite">
            <StatusBadge tone={STATE_TONE[file.state]}>{t(`state.${file.state}`)}</StatusBadge>
          </span>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-text-muted">{t('files.for')}</dt>
            <dd>{company ?? t('files.everyCompany')}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{t('files.findBy')}</dt>
            <dd>{t(`sensitivity.${file.sensitivity}`)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{t('files.kind')}</dt>
            <dd>
              {t(`source.${file.sourceType}`)}
              {file.state === 'indexed' ? `, ${t('files.passages', { count: file.chunks })}` : ''}
            </dd>
          </div>
        </dl>
        {file.errorReason === null ? null : <p className="text-sm">{errors(file.errorReason)}</p>}
        <FailureMessage failure={read.failure} />
      </section>
      {file.sourceType === 'audio' ? (
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <section
            aria-labelledby="knowledge-file-recording"
            className="flex min-w-0 flex-col gap-3"
          >
            <h2 id="knowledge-file-recording" className="text-h3">
              {t('file.recording')}
            </h2>
            {audioUrl === undefined ? (
              <p className="text-text-muted text-sm">{t('file.cannotPlay')}</p>
            ) : (
              // A spoken recording has no captions; its transcript beside it is its text
              // alternative (WCAG 1.2.1), named to the player by `aria-describedby`.
              <audio
                controls
                preload="metadata"
                src={audioUrl}
                aria-label={t('file.player', { title: file.title })}
                aria-describedby="knowledge-file-transcript"
                className="w-full"
              />
            )}
          </section>
          <TranscriptPanel
            file={file}
            entityId={entityId}
            canCorrect={canCorrect}
            onSaved={setFile}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A recording's transcript: being made while the file is first read; shown as it is to a reader;
 * corrected and saved by a holder of `knowledge.vault.write` once the file is not being read.
 */
function TranscriptPanel({
  file,
  entityId,
  canCorrect,
  onSaved,
}: {
  file: KnowledgeFileDetailDto;
  entityId: number;
  canCorrect: boolean;
  onSaved: (file: KnowledgeFileDetailDto) => void;
}) {
  const t = useTranslations('knowledge');
  const [text, setText] = useState(file.transcript ?? '');
  const [problem, setProblem] = useState<string | undefined>();
  const [notice, setNotice] = useState('');
  const correct = useCommand(correctKnowledgeTranscript, `transcript-${file.id}`);
  const editable = canCorrect && CORRECTABLE.has(file.state);

  // A transcript that arrives while the page is open (the first reading) fills the box.
  const [shown, setShown] = useState(file.transcript);
  if (file.transcript !== shown) {
    setShown(file.transcript);
    setText(file.transcript ?? '');
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim() === '') {
      setProblem(t('file.transcriptMissing'));
      return;
    }
    setProblem(undefined);
    correct.run({ entityId, knowledgeFileId: file.id, transcript: text }, (updated) => {
      setNotice(t('file.savedNotice'));
      onSaved({
        ...updated,
        transcript: text.trim(),
        transcriptCorrectedAt: new Date().toISOString(),
      });
    });
  }

  const corrected =
    file.transcriptCorrectedAt === null ? null : (
      <p className="text-text-subtle text-xs">
        {t('file.correctedOn')}{' '}
        <time dateTime={file.transcriptCorrectedAt}>{formatDate(file.transcriptCorrectedAt)}</time>
      </p>
    );

  return (
    <section
      aria-labelledby="knowledge-file-transcript-heading"
      className="flex min-w-0 flex-col gap-3"
    >
      <h2 id="knowledge-file-transcript-heading" className="text-h3">
        {t('file.transcript')}
      </h2>
      <p role="status" className="text-text-muted text-sm">
        {notice}
      </p>
      {editable ? (
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <Field
            id="knowledge-file-transcript"
            label={t('file.transcriptLabel')}
            helper={t('file.transcriptHint')}
            error={problem}
          >
            <Textarea
              value={text}
              rows={14}
              maxLength={TRANSCRIPT_MAX}
              spellCheck={false}
              onChange={(e) => {
                setText(e.target.value);
                setNotice('');
              }}
            />
          </Field>
          {corrected}
          <FailureMessage failure={correct.failure} />
          <Button type="submit" className="self-start" pending={correct.pending}>
            {t('file.save')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <p id="knowledge-file-transcript" className="break-words whitespace-pre-line">
            {file.transcript ??
              (file.state === 'waiting' ? t('file.transcribing') : t('file.noTranscript'))}
          </p>
          {file.transcript !== null && file.state === 'waiting' ? (
            <p className="text-text-muted text-sm">{t('file.readingAgain')}</p>
          ) : null}
          {corrected}
        </div>
      )}
    </section>
  );
}
