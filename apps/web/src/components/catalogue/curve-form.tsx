'use client';

import type { ItemDetailDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { setPumpCurve } from '../../actions/catalogue';
import { readCurve, type CurveProblem } from '../../screens/catalogue';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

const row = (flow: string, head: string): Row => ({ key: crypto.randomUUID(), flow, head });

interface Row {
  key: string;
  flow: string;
  head: string;
}

/** A pump's curve typed point by point, 2 to 30 of them, saved as a whole. */
export function CurveFormDialog({
  item,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  item: ItemDetailDto;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: (item: ItemDetailDto) => void;
}) {
  const t = useTranslations('catalogue.curveForm');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setPumpCurve);
  const [rows, setRows] = useState<Row[]>(() =>
    item.curve.length >= 2
      ? item.curve.map((p) => row(p.flowLph, p.headM))
      : [row('', ''), row('', '')],
  );
  const [problem, setProblem] = useState<CurveProblem | undefined>();
  const problemId = useId();
  const addButton = useRef<HTMLButtonElement>(null);

  function edit(key: string, change: Partial<Row>) {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const read = readCurve(rows);
    setProblem(read.ok ? undefined : read.problem);
    if (!read.ok) return;
    run({ itemId: item.id, points: read.points }, (saved) => {
      toast.success(t('saved', { name: item.name }));
      onSaved(saved);
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title', { name: item.name })}</DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          <table className="w-full text-left">
            <thead className="text-text-muted">
              <tr>
                <th scope="col" className="w-8">
                  <span className="sr-only">{t('pointColumn')}</span>
                </th>
                <th scope="col" className="pb-1 font-medium">
                  {t('flow')}
                </th>
                <th scope="col" className="pb-1 font-medium">
                  {t('head')}
                </th>
                <th scope="col" className="w-10">
                  <span className="sr-only">{t('removeColumn')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const number = i + 1;
                return (
                  <tr key={r.key}>
                    <th scope="row" className="text-text-muted pr-2 font-normal tabular-nums">
                      {number}
                    </th>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`${t('point', { number })}: ${t('flow')}`}
                        aria-describedby={problem === undefined ? undefined : problemId}
                        inputMode="decimal"
                        autoComplete="off"
                        value={r.flow}
                        className="tabular-nums"
                        onChange={(e) => {
                          edit(r.key, { flow: e.currentTarget.value });
                        }}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`${t('point', { number })}: ${t('head')}`}
                        aria-describedby={problem === undefined ? undefined : problemId}
                        inputMode="decimal"
                        autoComplete="off"
                        value={r.head}
                        className="tabular-nums"
                        onChange={(e) => {
                          edit(r.key, { head: e.currentTarget.value });
                        }}
                      />
                    </td>
                    <td className="py-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('removePoint', { number })}
                        disabled={rows.length <= 2}
                        onClick={() => {
                          setRows((all) => all.filter((x) => x.key !== r.key));
                          addButton.current?.focus();
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div>
            <Button
              ref={addButton}
              variant="secondary"
              size="sm"
              disabled={rows.length >= 30}
              onClick={() => {
                setRows((all) => [...all, row('', '')]);
              }}
            >
              {t('addPoint')}
            </Button>
          </div>
          {problem === undefined ? null : (
            <p id={problemId} role="alert" className="text-danger">
              {t(problem)}
            </p>
          )}
          <FailureMessage failure={failure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
