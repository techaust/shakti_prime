import type {
  DispositionDto,
  PipelineSettingsDto,
  StageExitField,
  StageSettingsDto,
  DispositionNextAction,
  ScoreFactor,
  ScoreRuleDto,
  Segment,
  SystemSizeUnit,
} from '@shakti/contracts';

// The pipelines settings page's drafts and the command inputs made from them (docs/design/phase1.md
// §6.6). Pure functions, so the screen and its tests share them. Values are sent as typed; the
// contracts and the commands decide what is wrong and answer with the field it is about.

/** A list with the item at `index` moved one place up (-1) or down (+1); unchanged at an end. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** A whole number typed in a box: the number, null when the box is empty, NaN when it is not one. */
export function wholeOrEmpty(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return /^-?\d+$/.test(t) ? Number(t) : Number.NaN;
}

/** A decimal typed in a box, as a number; undefined when empty. */
function decimalOrUndefined(text: string): number | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/** Districts typed one per line or separated by commas, each once, trimmed. */
export function districtList(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[\n,]/)
    .map((d) => d.trim())
    .filter((d) => {
      const k = d.toLowerCase();
      if (d === '' || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// --- Pipelines and stages --------------------------------------------------------------------

/**
 * The `crm.pipeline.update` fields that differ from the pipeline as typed; undefined when none
 * does. An empty time limit sets none; a box that is not a whole number is sent as such, so the
 * contract answers with the field it is about.
 */
export function pipelineChanges(
  pipeline: Pick<PipelineSettingsDto, 'name' | 'lockHours' | 'firstContactSlaMinutes'>,
  typed: { name: string; lockHours: string; firstContactSlaMinutes: string },
): { name?: string; lockHours?: number; firstContactSlaMinutes?: number | null } | undefined {
  const changes: { name?: string; lockHours?: number; firstContactSlaMinutes?: number | null } = {};
  const name = typed.name.trim();
  if (name !== pipeline.name) changes.name = name;
  const lock = wholeOrEmpty(typed.lockHours) ?? Number.NaN;
  if (lock !== pipeline.lockHours) changes.lockHours = lock;
  const sla = wholeOrEmpty(typed.firstContactSlaMinutes);
  if (sla !== pipeline.firstContactSlaMinutes) changes.firstContactSlaMinutes = sla;
  return Object.keys(changes).length === 0 ? undefined : changes;
}

/** The stages with a new one placed as the last open stage, before Won and Lost. */
export function withStage(
  stages: readonly StageSettingsDto[],
  stage: StageSettingsDto,
): StageSettingsDto[] {
  const open = stages.filter((s) => s.kind === 'open');
  const closing = stages.filter((s) => s.kind !== 'open');
  return [...open, stage, ...closing];
}

/**
 * The `crm.stage.update` fields that differ from the stage as edited; undefined when none does.
 * A Won or Lost stage has no exit rules, so only its name is compared.
 */
export function stageChanges(
  stage: Pick<StageSettingsDto, 'name' | 'kind' | 'requiredFields'>,
  edited: { name: string; requiredFields: readonly StageExitField[] },
): { name?: string; requiredFields?: StageExitField[] } | undefined {
  const changes: { name?: string; requiredFields?: StageExitField[] } = {};
  const name = edited.name.trim();
  if (name !== stage.name) changes.name = name;
  if (stage.kind === 'open' && edited.requiredFields.join(',') !== stage.requiredFields.join(',')) {
    changes.requiredFields = [...edited.requiredFields];
  }
  return Object.keys(changes).length === 0 ? undefined : changes;
}

// --- Call outcomes ----------------------------------------------------------------------------

export interface OutcomeDraft {
  /** A stable id for the row on screen: the stored id, or one made for a new row. */
  rowId: string;
  key: number;
  code?: string | undefined;
  label: string;
  nextAction: DispositionNextAction;
}

export function outcomeDrafts(list: readonly DispositionDto[]): OutcomeDraft[] {
  return list.map((d) => ({
    rowId: d.id,
    key: d.key,
    code: d.code,
    label: d.label,
    nextAction: d.nextAction,
  }));
}

/** The lowest number key from 1 to 9 no row uses; undefined when all nine are taken. */
export function nextFreeKey(drafts: readonly Pick<OutcomeDraft, 'key'>[]): number | undefined {
  const used = new Set(drafts.map((d) => d.key));
  for (let key = 1; key <= 9; key++) if (!used.has(key)) return key;
  return undefined;
}

/** The `crm.disposition.set` input for a scope and its rows as on screen. */
export function dispositionsInput(
  scope: { entityId: number | null; segment: Segment | null },
  drafts: readonly OutcomeDraft[],
) {
  return {
    ...scope,
    dispositions: drafts.map((d) => ({
      key: d.key,
      ...(d.code === undefined ? {} : { code: d.code }),
      label: d.label.trim(),
      nextAction: d.nextAction,
    })),
  };
}

// --- Score rules ------------------------------------------------------------------------------

export interface RuleDraft {
  rowId: string;
  factor: ScoreFactor;
  sourceCodes: string[];
  segments: Segment[];
  districts: string;
  unit: SystemSizeUnit;
  min: string;
  max: string;
  points: string;
}

export function emptyRule(rowId: string): RuleDraft {
  return {
    rowId,
    factor: 'source',
    sourceCodes: [],
    segments: [],
    districts: '',
    unit: 'kw',
    min: '',
    max: '',
    points: '10',
  };
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const numberText = (v: unknown): string => (typeof v === 'number' ? String(v) : '');

/** A stored rule as the editor shows it. */
export function ruleDraft(rule: ScoreRuleDto): RuleDraft {
  const m = rule.match;
  const draft = emptyRule(rule.id);
  draft.factor = rule.factor;
  draft.points = String(rule.points);
  switch (rule.factor) {
    case 'source':
      draft.sourceCodes = strings(m.sourceCodes);
      break;
    case 'segment':
      draft.segments = strings(m.segments) as Segment[];
      break;
    case 'district':
      draft.districts = strings(m.districts).join(', ');
      break;
    case 'system_size':
      draft.unit = m.unit === 'hp' ? 'hp' : 'kw';
      draft.min = numberText(m.min);
      draft.max = numberText(m.max);
      break;
    case 'age_days':
      draft.min = numberText(m.minDays);
      draft.max = numberText(m.maxDays);
      break;
  }
  return draft;
}

function withBounds<K extends string>(
  low: K,
  high: K,
  min: number | undefined,
  max: number | undefined,
): Partial<Record<K, number>> {
  return {
    ...(min === undefined ? {} : { [low]: min }),
    ...(max === undefined ? {} : { [high]: max }),
  } as Partial<Record<K, number>>;
}

/** One rule of the `crm.score_rule.set` input, from its row on screen. */
export function ruleInput(d: RuleDraft): { factor: ScoreFactor; match: object; points: number } {
  const points = wholeOrEmpty(d.points) ?? Number.NaN;
  switch (d.factor) {
    case 'source':
      return { factor: d.factor, match: { sourceCodes: d.sourceCodes }, points };
    case 'segment':
      return { factor: d.factor, match: { segments: d.segments }, points };
    case 'district':
      return { factor: d.factor, match: { districts: districtList(d.districts) }, points };
    case 'system_size':
      return {
        factor: d.factor,
        match: {
          unit: d.unit,
          ...withBounds('min', 'max', decimalOrUndefined(d.min), decimalOrUndefined(d.max)),
        },
        points,
      };
    case 'age_days': {
      const min = wholeOrEmpty(d.min) ?? undefined;
      const max = wholeOrEmpty(d.max) ?? undefined;
      return { factor: d.factor, match: withBounds('minDays', 'maxDays', min, max), points };
    }
  }
}

/** The whole `crm.score_rule.set` input for a scope. */
export function scoreRulesInput(
  scope: { entityId: number | null; segment: Segment | null },
  drafts: readonly RuleDraft[],
) {
  return { ...scope, rules: drafts.map(ruleInput) };
}

/** A scope chosen on screen, from the two pickers' values (`group` and `all` mean none). */
export function scopeOf(
  company: string,
  segment: string,
): {
  entityId: number | null;
  segment: Segment | null;
} {
  const entityId = company === 'group' ? null : Number(company);
  return {
    entityId: Number.isInteger(entityId) ? entityId : null,
    segment: segment === 'all' ? null : (segment as Segment),
  };
}
