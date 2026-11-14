// Ask the Business on screen (docs/03-roadmap-appendix/phase2.md §6.5): an answer as the screen
// shows it. The stored answer cites records as `[ref:<id>]` and marks each figure or citation the
// grounding filter took out as `[unsourced]` (`UNSOURCED` in packages/domain, which a test keeps
// equal); neither marker ever reaches a person as text: a citation becomes a numbered link to its
// source, a taken-out figure the catalogue's sentence. Pure functions; browser code takes only
// types from the contracts.

import type { AskSourceKind, AskSourceLabelDto } from '@shakti/contracts';

/** The filter's mark for what it took out (`UNSOURCED`). */
export const UNSOURCED_MARK = '[unsourced]';

/** One run of an answer's paragraph. */
export type AnswerPart =
  { kind: 'text'; text: string } | { kind: 'cite'; id: string } | { kind: 'unsourced' };

const MARKS = /\[ref:([0-9a-f-]{36})\]|\[unsourced\]/gi;

/** An answer as paragraphs of runs: text, a citation by id, or a figure taken out. */
export function answerParts(answer: string): AnswerPart[][] {
  return answer
    .split(/\n{2,}|\n(?=\s*(?:[-*•]|\d{1,2}[.)])\s)/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((paragraph) => {
      const parts: AnswerPart[] = [];
      let at = 0;
      for (const m of paragraph.matchAll(MARKS)) {
        if (m.index > at) parts.push({ kind: 'text', text: paragraph.slice(at, m.index) });
        const id = m[1];
        parts.push(
          id === undefined ? { kind: 'unsourced' } : { kind: 'cite', id: id.toLowerCase() },
        );
        at = m.index + m[0].length;
      }
      if (at < paragraph.length) parts.push({ kind: 'text', text: paragraph.slice(at) });
      return parts;
    });
}

/** Each cited record's number in the answer, in order of first citation, from 1. */
export function citationNumbers(answer: string): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const m of answer.matchAll(MARKS)) {
    const id = m[1]?.toLowerCase();
    if (id !== undefined && !numbers.has(id)) numbers.set(id, numbers.size + 1);
  }
  return numbers;
}

/** Where a cited record opens, as the person may open it; none for a record with no screen of its own. */
export function sourceHref(source: AskSourceLabelDto): string | undefined {
  if (source.label === null) return undefined;
  const byKind: Readonly<Record<AskSourceKind, string | undefined>> = {
    quote: source.entityId === null ? undefined : `/quotes/${String(source.entityId)}/${source.id}`,
    sales_order:
      source.entityId === null ? undefined : `/orders/${String(source.entityId)}/${source.id}`,
    opportunity: source.accountId === null ? undefined : `/customers/${source.accountId}`,
    account: source.accountId === null ? undefined : `/customers/${source.accountId}`,
    knowledge_file: '/knowledge',
    playbook_directive: undefined,
    pipeline_stage: '/leads/board',
    item: '/catalogue',
  };
  return byKind[source.kind];
}

/** A figure the answer gives, as a card: its words and the record its sentence cites, if any. */
export interface AnswerFigure {
  value: string;
  sourceId: string | undefined;
}

const FIGURE = /₹\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:lakh|crore))?|\b\d[\d,]*(?:\.\d+)?\s?%/gi;

/**
 * The amounts in rupees and the percentages of an answer, as cards, each once, with the first
 * record cited in the same sentence. Only figures the filter passed are in the stored answer.
 */
export function answerFigures(answer: string): AnswerFigure[] {
  const out: AnswerFigure[] = [];
  const seen = new Set<string>();
  for (const sentence of answer.split(/(?<=[.!?])\s+|\n+/)) {
    const cited = /\[ref:([0-9a-f-]{36})\]/i.exec(sentence)?.[1]?.toLowerCase();
    for (const m of sentence.matchAll(FIGURE)) {
      const value = m[0].replace(/\s+/g, ' ').trim();
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({ value, sourceId: cited });
    }
  }
  return out;
}
