'use client';

import type { ProjectSegment, ProjectStep, ProjectTemplatesDto } from '@shakti/contracts';
import { Button, Field, Input, Select, toast } from '@shakti/ui';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { publishProjectTemplate } from '../../actions/projects';
import { DEFAULT_PROJECT_STEPS } from '../../screens/contract-values';
import { formatDate } from '../../screens/format';
import { stepKeyFrom } from '../../screens/projects';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';
import { useStepName } from './use-step-name';

/** The most steps a checklist holds (`PROJECT_STEPS_MAX`). */
const STEPS_MAX = 30;

/** A step as the editor holds it: its key once it has one (a step of the version shown). */
interface DraftStep {
  id: number;
  key: string | undefined;
  title: string;
  requires: string[];
}

/**
 * Settings › Project steps (docs/03-roadmap-appendix/phase4.md §6.1, question 2 (a)): each business
 * line's current steps for one company, and the Executive's new version, named in order. A step
 * kept from the version shown keeps its key and the documents it requires; a new one gets a key
 * from its name. Publishing makes the new version current for new projects only.
 */
export function StepsScreen({
  entityId,
  initial,
  companies,
}: {
  entityId: number;
  initial: ProjectTemplatesDto;
  companies: Record<number, string>;
}) {
  const t = useTranslations('projectSteps');
  const projects = useTranslations('projects');
  const stepName = useStepName();
  const router = useRouter();
  const [editing, setEditing] = useState<ProjectSegment | undefined>();
  const ids = Object.keys(companies).map(Number);

  return (
    <div className="flex flex-col gap-6">
      {ids.length > 1 ? (
        <Field id="steps-company" label={t('company')}>
          <Select
            defaultValue={String(entityId)}
            onChange={(e) => {
              router.push(`/settings/project-steps?company=${e.currentTarget.value}` as Route);
            }}
          >
            {ids.map((id) => (
              <option key={id} value={id}>
                {companies[id]}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {initial.segments.map((s) => {
        const steps: ProjectStep[] =
          s.current?.steps ??
          DEFAULT_PROJECT_STEPS.map((key) => ({
            key,
            title: stepName({ key, title: null }),
            requires: [],
          }));
        return (
          <section
            key={s.segment}
            aria-labelledby={`steps-${s.segment}`}
            className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 id={`steps-${s.segment}`} className="text-h3">
                  {projects(`segments.${s.segment}`)}
                </h2>
                <p className="text-text-muted text-sm">
                  {s.current === null
                    ? t('none')
                    : t('version', {
                        version: s.current.version,
                        date: formatDate(s.current.publishedAt),
                      })}
                </p>
              </div>
              {editing === s.segment ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEditing(s.segment);
                  }}
                >
                  {t('edit')}
                </Button>
              )}
            </div>
            {editing === s.segment ? (
              <StepsEditor
                entityId={entityId}
                segment={s.segment}
                steps={steps}
                onDone={() => {
                  setEditing(undefined);
                  toast.success(t('published'));
                  router.refresh();
                }}
                onCancel={() => {
                  setEditing(undefined);
                }}
              />
            ) : (
              <ol className="flex list-decimal flex-col gap-1 pl-6">
                {steps.map((step) => (
                  <li key={step.key}>{step.title}</li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

function StepsEditor({
  entityId,
  segment,
  steps,
  onDone,
  onCancel,
}: {
  entityId: number;
  segment: ProjectSegment;
  steps: readonly ProjectStep[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('projectSteps');
  const projects = useTranslations('projects');
  const common = useTranslations('common');
  const [rows, setRows] = useState<DraftStep[]>(() =>
    steps.map((s, i) => ({ id: i, key: s.key, title: s.title, requires: [...s.requires] })),
  );
  const [nextId, setNextId] = useState(steps.length);
  const [problem, setProblem] = useState<'nameMissing' | 'tooFew' | undefined>();
  const { run, pending, failure } = useCommand(publishProjectTemplate);

  function move(index: number, by: -1 | 1) {
    setRows((now) => {
      const to = index + by;
      if (to < 0 || to >= now.length) return now;
      const copy = [...now];
      const [row] = copy.splice(index, 1);
      if (row !== undefined) copy.splice(to, 0, row);
      return copy;
    });
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (rows.length === 0) {
      setProblem('tooFew');
      return;
    }
    if (rows.some((r) => r.title.trim() === '')) {
      setProblem('nameMissing');
      return;
    }
    setProblem(undefined);
    const taken = new Set(rows.flatMap((r) => (r.key === undefined ? [] : [r.key])));
    const published = rows.map((r) => {
      if (r.key !== undefined) return { key: r.key, title: r.title.trim(), requires: r.requires };
      const key = stepKeyFrom(r.title, taken);
      taken.add(key);
      return { key, title: r.title.trim(), requires: r.requires };
    });
    run({ entityId, segment, steps: published }, onDone);
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3"
      aria-label={t('editTitle', { segment: projects(`segments.${segment}`) })}
      noValidate
    >
      <p className="text-text-muted text-sm">{t('editIntro')}</p>
      <ol className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={row.id}>
            <Field
              id={`step-${segment}-${String(row.id)}`}
              label={t('stepName', { number: index + 1 })}
              actions={
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={index === 0}
                    onClick={() => {
                      move(index, -1);
                    }}
                  >
                    {t('moveUp')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={index === rows.length - 1}
                    onClick={() => {
                      move(index, 1);
                    }}
                  >
                    {t('moveDown')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setRows((now) => now.filter((r) => r.id !== row.id));
                    }}
                  >
                    {t('remove')}
                  </Button>
                </>
              }
            >
              <Input
                value={row.title}
                maxLength={80}
                autoComplete="off"
                onChange={(e) => {
                  const title = e.currentTarget.value;
                  setRows((now) => now.map((r) => (r.id === row.id ? { ...r, title } : r)));
                }}
              />
            </Field>
          </li>
        ))}
      </ol>
      {problem === undefined ? null : (
        <p role="alert" className="text-danger text-sm">
          {t(problem)}
        </p>
      )}
      <FailureMessage failure={failure} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={rows.length >= STEPS_MAX}
          onClick={() => {
            setRows((now) => [...now, { id: nextId, key: undefined, title: '', requires: [] }]);
            setNextId((n) => n + 1);
          }}
        >
          {t('add')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={pending}>
          {t('publish')}
        </Button>
      </div>
      {rows.length >= STEPS_MAX ? <p className="text-text-muted text-sm">{t('tooMany')}</p> : null}
    </form>
  );
}
