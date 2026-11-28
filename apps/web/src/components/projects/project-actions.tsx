'use client';

import type { ProjectPeopleDto, ProjectState } from '@shakti/contracts';
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
  Textarea,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  assignProject,
  cancelProject,
  completeProject,
  holdProject,
  listProjectPeople,
  resumeProject,
} from '../../actions/projects';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

type Asking = 'hold' | 'cancel' | 'complete' | 'assign';

interface ProjectFacts {
  entityId: number;
  id: string;
  projectNo: string;
  state: ProjectState;
  flow: 'standard' | 'surya_ghar';
  ownerId: string | null;
  assigneeIds: readonly string[];
  /** Every step is done or skipped. */
  stepsDone: boolean;
}

function Frame({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const common = useTranslations('common');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')}>{children}</DialogContent>
    </Dialog>
  );
}

/**
 * The project page's moves for a Project Manager or General Manager (`projects.write` for the
 * company): put on hold with a reason, resume, complete once every step is done, cancel with a
 * reason, and name the project manager and the people on the project. Each goes through its
 * command, then the page is read again.
 */
export function ProjectActions({ project }: { project: ProjectFacts }) {
  const t = useTranslations('projects');
  const router = useRouter();
  const [asking, setAsking] = useState<Asking | undefined>();
  const resume = useCommand(resumeProject);
  const standard = project.flow === 'standard';
  const open = project.state === 'active' || project.state === 'on_hold';

  function done(message: string) {
    setAsking(undefined);
    toast.success(message);
    router.refresh();
  }

  const ref = { entityId: project.entityId, projectId: project.id };
  return (
    <>
      {open ? (
        <Button
          variant="secondary"
          onClick={() => {
            setAsking('assign');
          }}
        >
          {t('actions.assign')}
        </Button>
      ) : null}
      {standard && project.state === 'active' ? (
        <Button
          variant="secondary"
          onClick={() => {
            setAsking('hold');
          }}
        >
          {t('actions.hold')}
        </Button>
      ) : null}
      {standard && project.state === 'on_hold' ? (
        <Button
          variant="secondary"
          pending={resume.pending}
          onClick={() => {
            resume.run(ref, () => {
              done(t('actions.resumed'));
            });
          }}
        >
          {t('actions.resume')}
        </Button>
      ) : null}
      {standard && project.state === 'active' && project.stepsDone ? (
        <Button
          onClick={() => {
            setAsking('complete');
          }}
        >
          {t('actions.complete')}
        </Button>
      ) : null}
      {standard && open ? (
        <Button
          variant="secondary"
          onClick={() => {
            setAsking('cancel');
          }}
        >
          {t('actions.cancel')}
        </Button>
      ) : null}
      <FailureMessage failure={resume.failure} />
      {asking === 'hold' || asking === 'cancel' ? (
        <ReasonDialog
          kind={asking}
          project={project}
          onClose={() => {
            setAsking(undefined);
          }}
          onDone={() => {
            done(asking === 'hold' ? t('actions.held') : t('actions.cancelled'));
          }}
        />
      ) : null}
      {asking === 'complete' ? (
        <CompleteDialog
          project={project}
          onClose={() => {
            setAsking(undefined);
          }}
          onDone={() => {
            done(t('actions.completed'));
          }}
        />
      ) : null}
      {asking === 'assign' ? (
        <AssignDialog
          project={project}
          onClose={() => {
            setAsking(undefined);
          }}
          onDone={() => {
            done(t('actions.assigned'));
          }}
        />
      ) : null}
    </>
  );
}

function ReasonDialog({
  kind,
  project,
  onClose,
  onDone,
}: {
  kind: 'hold' | 'cancel';
  project: ProjectFacts;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('projects.dialogs');
  const { run, pending, failure } = useCommand(kind === 'hold' ? holdProject : cancelProject);
  const { fieldError, formFailure } = useFieldFailure(failure, ['reason']);
  const [missing, setMissing] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const reason = formText(new FormData(e.currentTarget), 'reason');
    if (reason === '') {
      setMissing(true);
      return;
    }
    setMissing(false);
    run({ entityId: project.entityId, projectId: project.id, reason }, onDone);
  }

  return (
    <Frame onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>
            {kind === 'hold'
              ? t('holdTitle', { projectNo: project.projectNo })
              : t('cancelTitle', { projectNo: project.projectNo })}
          </DialogTitle>
          <DialogDescription>
            {kind === 'hold' ? t('holdIntro') : t('cancelIntro')}
          </DialogDescription>
        </DialogHeader>
        <Field
          id="project-reason"
          label={t('reason')}
          helper={t('reasonHelper')}
          error={missing ? t('reasonMissing') : fieldError('reason')}
        >
          <Textarea name="reason" rows={3} maxLength={300} />
        </Field>
        <FailureMessage failure={formFailure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('keep')}
          </Button>
          <Button type="submit" pending={pending}>
            {kind === 'hold' ? t('holdSubmit') : t('cancelSubmit')}
          </Button>
        </DialogFooter>
      </form>
    </Frame>
  );
}

function CompleteDialog({
  project,
  onClose,
  onDone,
}: {
  project: ProjectFacts;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('projects.dialogs');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(completeProject);
  return (
    <Frame onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{t('completeTitle', { projectNo: project.projectNo })}</DialogTitle>
        <DialogDescription>{t('completeIntro')}</DialogDescription>
      </DialogHeader>
      <FailureMessage failure={failure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          {common('cancel')}
        </Button>
        <Button
          pending={pending}
          onClick={() => {
            run({ entityId: project.entityId, projectId: project.id }, onDone);
          }}
        >
          {t('completeSubmit')}
        </Button>
      </DialogFooter>
    </Frame>
  );
}

function AssignDialog({
  project,
  onClose,
  onDone,
}: {
  project: ProjectFacts;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('projects.dialogs');
  const common = useTranslations('common');
  const people = useQuery<ProjectPeopleDto>();
  const [list, setList] = useState<ProjectPeopleDto['people']>([]);
  const [chosen, setChosen] = useState<readonly string[]>(project.assigneeIds);
  const { run, pending, failure } = useCommand(assignProject);
  const { load } = people;

  useEffect(() => {
    load(
      () => listProjectPeople({ entityId: project.entityId }),
      (answer) => {
        setList(answer.people);
      },
    );
  }, [load, project.entityId]);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const owner = formText(new FormData(e.currentTarget), 'owner');
    run(
      {
        entityId: project.entityId,
        projectId: project.id,
        ownerId: owner === '' ? null : owner,
        assigneeIds: [...chosen],
      },
      onDone,
    );
  }

  return (
    <Frame onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('assignTitle', { projectNo: project.projectNo })}</DialogTitle>
          <DialogDescription>{t('assignIntro')}</DialogDescription>
        </DialogHeader>
        <FailureMessage failure={people.failure} />
        <Field id="project-owner" label={t('owner')}>
          <Select name="owner" defaultValue={project.ownerId ?? ''} key={list.length}>
            <option value="">{t('ownerNone')}</option>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t('people')}</legend>
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {list.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-accent size-4"
                  checked={chosen.includes(p.id)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setChosen((now) => (on ? [...now, p.id] : now.filter((id) => id !== p.id)));
                  }}
                />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <FailureMessage failure={failure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button type="submit" pending={pending}>
            {t('assignSubmit')}
          </Button>
        </DialogFooter>
      </form>
    </Frame>
  );
}
