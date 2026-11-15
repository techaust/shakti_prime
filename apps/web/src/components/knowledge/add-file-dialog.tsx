'use client';

import type { KnowledgeSensitivity } from '@shakti/contracts';
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
  Uploader,
  type UploadControls,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { addKnowledgeFile } from '../../actions/knowledge';
import { fileTypeKey, sizeParts } from '../../screens/files';
import { sendFile } from '../files/send-file';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';
import type { KnowledgeCompany, KnowledgeWriter } from './knowledge-screen';

/** The vault's Office and WAV types by their name's ending, for a browser that does not say the type. */
const BY_ENDING: Readonly<Record<string, string>> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  wav: 'audio/wav',
};

/** The names browsers give a WAV, each taken as the one type the vault knows. */
const WAV_NAMES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']);

function vaultTypeOf(file: File): string {
  if (WAV_NAMES.has(file.type)) return 'audio/wav';
  if (file.type !== '') return file.type;
  const ending = file.name.split('.').pop()?.toLowerCase() ?? '';
  return Object.hasOwn(BY_ENDING, ending) ? (BY_ENDING[ending] ?? '') : '';
}

/** Who a new file is for: one company, or every company (`group`). */
type ForChoice = number | 'group';

/** The upload once its bytes have landed: its id and the company it is stored in. */
interface Landed {
  fileId: string;
  entityId: number;
}

/**
 * Add a file to the Knowledge Vault (docs/03-roadmap-appendix/phase1.md §8.4), loaded when it is opened: a
 * title, who it is for and who may find it, then the upload, then Add to the vault, which records
 * it (`knowledge.file.add`). A file for every company is stored with the first company viewed and
 * offered only while All companies is chosen. Once the file is uploaded, who it is for stays as
 * it was, since the file is stored with that company.
 */
export function AddFileDialog({
  writer,
  companies,
  allCompanies,
  onClose,
  onAdded,
}: {
  writer: KnowledgeWriter;
  companies: readonly KnowledgeCompany[];
  allCompanies: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const t = useTranslations('knowledge');
  const files = useTranslations('files');
  const errors = useTranslations('errors');
  const common = useTranslations('common');
  const add = useCommand(addKnowledgeFile);
  const firstCompany = companies[0]?.id ?? 0;
  const [title, setTitle] = useState('');
  const [forChoice, setForChoice] = useState<ForChoice>(allCompanies ? 'group' : firstCompany);
  const [sensitivity, setSensitivity] = useState<KnowledgeSensitivity>(
    writer.sensitivities[0] ?? 'staff_ai_ok',
  );
  const [recorded, setRecorded] = useState<Landed | undefined>();
  const [landed, setLanded] = useState(false);
  const [problem, setProblem] = useState<'titleMissing' | 'uploadFirst' | undefined>();

  const storedIn = forChoice === 'group' ? firstCompany : forChoice;
  // Documents and photos, then a recording, each with its own size.
  const types = new Intl.ListFormat('en-IN', { type: 'disjunction' }).format(
    writer.limit.contentTypes.flatMap((type) => {
      const key = fileTypeKey(type);
      return key === undefined || type === 'audio/wav' ? [] : [files(`shortTypes.${key}`)];
    }),
  );
  const size = sizeParts(writer.limit.maxBytes);
  const sizeText = files(`size.${size.unit}`, { value: size.value });
  const recordingSize = sizeParts(writer.limit.recordingMaxBytes);
  const recordingSizeText = files(`size.${recordingSize.unit}`, { value: recordingSize.value });

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim() === '') {
      setProblem('titleMissing');
      return;
    }
    if (recorded === undefined || !landed) {
      setProblem('uploadFirst');
      return;
    }
    setProblem(undefined);
    add.run(
      {
        entityId: recorded.entityId,
        fileId: recorded.fileId,
        title: title.trim(),
        sensitivity,
        wholeGroup: forChoice === 'group',
      },
      () => {
        onAdded();
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
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('addTitle')}</DialogTitle>
            <DialogDescription>{t('addIntro')}</DialogDescription>
          </DialogHeader>
          <Field
            id="knowledge-title"
            label={t('titleLabel')}
            helper={t('titleHint')}
            error={problem === 'titleMissing' ? t('titleMissing') : undefined}
          >
            <Input
              value={title}
              maxLength={200}
              autoComplete="off"
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          </Field>
          <Field
            id="knowledge-for"
            label={t('forLabel')}
            {...(allCompanies ? {} : { helper: t('forHint') })}
          >
            <Select
              value={String(forChoice)}
              disabled={recorded !== undefined}
              onChange={(e) => {
                setForChoice(e.target.value === 'group' ? 'group' : Number(e.target.value));
              }}
            >
              {allCompanies ? <option value="group">{t('files.everyCompany')}</option> : null}
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="knowledge-sensitivity"
            label={t('findByLabel')}
            helper={t(`sensitivityHelp.${sensitivity}`)}
          >
            <Select
              value={sensitivity}
              onChange={(e) => {
                const next = writer.sensitivities.find((s) => s === e.target.value);
                if (next !== undefined) setSensitivity(next);
              }}
            >
              {writer.sensitivities.map((s) => (
                <option key={s} value={s}>
                  {t(`sensitivity.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Uploader
            id="knowledge-file"
            label={t('fileLabel')}
            hint={t('fileHint', { types, size: sizeText, recordingSize: recordingSizeText })}
            accept={writer.limit.contentTypes}
            maxBytes={Math.max(writer.limit.maxBytes, writer.limit.recordingMaxBytes)}
            typeOf={vaultTypeOf}
            text={{
              choose: files('uploader.choose'),
              drop: files('uploader.drop'),
              cancel: files('uploader.cancel'),
              retry: files('uploader.retry'),
              started: files('uploader.started'),
              halfway: files('uploader.halfway'),
              cancelled: files('uploader.cancelled'),
              failed: files('uploader.failed'),
              wrongType: t('fileWrongType', { types }),
              tooLarge: t('fileTooLarge', { size: sizeText, recordingSize: recordingSizeText }),
              empty: files('uploader.empty'),
            }}
            upload={(file: File, controls: UploadControls) => {
              setLanded(false);
              // The uploader holds every file to a recording's size; any other file is smaller.
              if (vaultTypeOf(file) !== 'audio/wav' && file.size > writer.limit.maxBytes) {
                return Promise.resolve({
                  status: 'failed' as const,
                  message: t('fileTooLarge', { size: sizeText, recordingSize: recordingSizeText }),
                  canRetry: false,
                });
              }
              return sendFile(
                file,
                { entityId: storedIn, purpose: 'knowledge', contentType: vaultTypeOf(file) },
                controls,
                {
                  checking: files('uploader.checking'),
                  checkingLong: files('uploader.checkingLong'),
                  ready: t('uploaded'),
                  failed: files('uploader.failed'),
                  error: (key) => errors(key),
                },
                (fileId) => {
                  setRecorded({ fileId, entityId: storedIn });
                },
              );
            }}
            onUploaded={(result) => {
              // Checked or still being checked: either way the file may be added now.
              setLanded(result.status === 'done' || result.status === 'waiting');
            }}
          />
          {problem === 'uploadFirst' ? (
            <p role="alert" className="text-danger text-sm">
              {t('uploadFirst')}
            </p>
          ) : null}
          <FailureMessage failure={add.failure} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={add.pending}>
              {t('addToVault')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
