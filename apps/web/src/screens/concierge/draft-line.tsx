'use client';

import type { ConciergeDraftDto } from '@shakti/contracts';
import { Button, Field, Textarea, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { approveSuggestion, editSuggestion, rejectSuggestion } from '../../actions/agents';
import { loadConciergeDraft } from '../../actions/concierge';
import { FailureMessage } from '../../components/screens/failure';
import { useCommand, useQuery } from '../../components/screens/use-command';
import { formatDateTime } from '../format';
import { draftKeyAction } from './keys';

/** The longest reply the assistant drafts, which an edit keeps to. */
const REPLY_MAX = 600;

/** Typing in a field is never a shortcut. */
function typing(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * The assistant's draft in a chat (docs/03-roadmap-appendix/phase2.md §7.2, A3): under Needs
 * approval, the reply the WhatsApp Concierge drafted to the customer's newest message, shown to
 * the person whose Agent Inbox holds it, who sends it (S), edits it and sends their words (E), or
 * discards it (D). Each runs as that person through the inbox's own decision; nothing reaches the
 * customer before it. Shows nothing when there is no draft for the viewer (in Shadow there never
 * is). Read once for the chat's newest message: the chat mounts it afresh when a message comes.
 */
export function ConciergeDraftLine({
  entityId,
  threadId,
  onDecided,
}: {
  entityId: number;
  threadId: string;
  onDecided: () => void;
}) {
  const t = useTranslations('messaging.draft');
  const id = useId();
  const [draft, setDraft] = useState<ConciergeDraftDto['draft']>(null);
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState('');
  const read = useQuery<ConciergeDraftDto>();
  const send = useCommand(approveSuggestion, `draft-send:${threadId}`);
  const edit = useCommand(editSuggestion, `draft-edit:${threadId}`);
  const discard = useCommand(rejectSuggestion, `draft-discard:${threadId}`);
  const pending = send.pending || edit.pending || discard.pending;

  useEffect(() => {
    read.load(
      () => loadConciergeDraft({ entityId, threadId }),
      (data) => {
        setDraft(data.draft);
        setWords(data.draft?.body ?? '');
      },
    );
    // Read once for the chat it is given; a new message mounts it afresh (its key).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the same read for this chat
  }, []);

  if (draft === null) return <FailureMessage failure={read.failure} />;
  const ref = { entityId, itemId: draft.itemId };

  function decided(message: string): () => void {
    return () => {
      setDraft(null);
      toast.success(message);
      onDecided();
    };
  }
  function act(action: 'send' | 'edit' | 'discard') {
    if (pending) return;
    if (action === 'send') send.run(ref, decided(t('sent')));
    else if (action === 'discard') discard.run(ref, decided(t('discarded')));
    else setEditing(true);
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (editing || typing(event.target)) return;
    const action = draftKeyAction(event);
    if (action === undefined) return;
    event.preventDefault();
    act(action);
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      onKeyDown={onKeyDown}
      className="border-border bg-surface-2 flex flex-col gap-2 rounded-lg border p-3"
      data-testid="concierge-draft"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-heading`} className="text-sm font-medium">
          {t('heading')}
        </h3>
        <p className="text-text-muted text-xs">
          {t('drafted', { when: formatDateTime(draft.createdAt) })}
        </p>
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            edit.run({ ...ref, changes: { body: words } }, decided(t('sent')));
          }}
        >
          <Field
            id={`${id}-words`}
            label={t('editLabel')}
            helper={t('editHelper')}
            actions={
              <>
                <Button type="submit" disabled={pending || words.trim() === ''}>
                  {t('send')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditing(false);
                    setWords(draft.body);
                  }}
                >
                  {t('cancel')}
                </Button>
              </>
            }
          >
            <Textarea
              rows={3}
              maxLength={REPLY_MAX}
              value={words}
              onChange={(e) => {
                setWords(e.target.value);
              }}
            />
          </Field>
        </form>
      ) : (
        <>
          <p className="text-sm whitespace-pre-wrap">{draft.body}</p>
          <p className="text-text-muted text-xs">{t('helper')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={pending}
              aria-keyshortcuts="S"
              onClick={() => {
                act('send');
              }}
            >
              {t('send')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              aria-keyshortcuts="E"
              onClick={() => {
                act('edit');
              }}
            >
              {t('edit')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              aria-keyshortcuts="D"
              onClick={() => {
                act('discard');
              }}
            >
              {t('discard')}
            </Button>
            <p className="text-text-muted text-xs">{t('keys')}</p>
          </div>
        </>
      )}
      <FailureMessage failure={send.failure ?? edit.failure ?? discard.failure} />
    </section>
  );
}
