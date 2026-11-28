'use client';

import type { ProjectSegment } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Select,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { createProject } from '../../actions/projects';
import { PROJECT_SEGMENTS } from '../../screens/contract-values';
import { projectHref } from '../../screens/projects';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/**
 * The order page's Start project (docs/03-roadmap-appendix/phase4.md §6.1): a Project Manager or
 * General Manager makes the project of a confirmed order that has none, with the lead's business
 * line or the one they choose (a dealer's order has no lead), then opens it.
 */
export function StartProject({
  entityId,
  orderId,
  soNo,
}: {
  entityId: number;
  orderId: string;
  soNo: string;
}) {
  const t = useTranslations('projects.order');
  const projects = useTranslations('projects');
  const common = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run, pending, failure } = useCommand(createProject);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const chosen = formText(new FormData(e.currentTarget), 'segment');
    const segment = (PROJECT_SEGMENTS as readonly string[]).includes(chosen)
      ? (chosen as ProjectSegment)
      : null;
    run({ entityId, orderId, segment }, (project) => {
      setOpen(false);
      toast.success(t('started'));
      router.push(projectHref(entityId, project.id));
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('startProject')}
      </Button>
      {open ? (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setOpen(false);
          }}
        >
          <DialogContent closeLabel={common('close')}>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <DialogHeader>
                <DialogTitle>{t('startTitle', { soNo })}</DialogTitle>
                <DialogDescription>{t('startIntro')}</DialogDescription>
              </DialogHeader>
              <Field id="start-project-segment" label={t('segment')}>
                <Select name="segment" defaultValue="">
                  <option value="">{t('segmentFromLead')}</option>
                  {PROJECT_SEGMENTS.map((s) => (
                    <option key={s} value={s}>
                      {projects(`segments.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <FailureMessage failure={failure} />
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  {common('cancel')}
                </Button>
                <Button type="submit" pending={pending}>
                  {t('startSubmit')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
