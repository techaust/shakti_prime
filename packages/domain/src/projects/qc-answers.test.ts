import { newId, type ChecklistItem } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { answersFillChecklist, photoIdsOf } from './qc-answers';

const ITEMS: ChecklistItem[] = [
  { key: 'earthing', label: 'Earthing done', kind: 'yes_no', min: null, max: null },
  { key: 'voltage', label: 'Output voltage', kind: 'number', min: 200, max: 250 },
  { key: 'remarks', label: 'Remarks', kind: 'text', min: null, max: null },
  { key: 'panel_photo', label: 'Panels from the front', kind: 'photo_required', min: null, max: null },
];

const PHOTO = newId();
const FULL = [
  { key: 'earthing', value: false },
  { key: 'voltage', value: 230 },
  { key: 'remarks', value: 'Mounted on the east roof' },
  { key: 'panel_photo', value: [PHOTO] },
];

describe('answersFillChecklist', () => {
  it('takes one answer of its kind per item, a "no" included', () => {
    expect(answersFillChecklist(ITEMS, FULL)).toBe(true);
  });

  it('takes a number on its bounds and refuses one beyond them', () => {
    const at = (voltage: number) =>
      answersFillChecklist(
        ITEMS,
        FULL.map((a) => (a.key === 'voltage' ? { key: 'voltage', value: voltage } : a)),
      );
    expect(at(200)).toBe(true);
    expect(at(250)).toBe(true);
    expect(at(199.99)).toBe(false);
    expect(at(250.01)).toBe(false);
  });

  it('refuses a missing, extra, repeated or mistyped answer', () => {
    expect(answersFillChecklist(ITEMS, FULL.slice(1))).toBe(false);
    expect(answersFillChecklist(ITEMS, [...FULL, { key: 'extra', value: true }])).toBe(false);
    expect(
      answersFillChecklist(ITEMS, [...FULL.slice(0, 3), { key: 'earthing', value: true }]),
    ).toBe(false);
    expect(
      answersFillChecklist(
        ITEMS,
        FULL.map((a) => (a.key === 'earthing' ? { key: 'earthing', value: 'yes' } : a)),
      ),
    ).toBe(false);
    expect(
      answersFillChecklist(
        ITEMS,
        FULL.map((a) => (a.key === 'panel_photo' ? { key: 'panel_photo', value: true } : a)),
      ),
    ).toBe(false);
  });

  it('never fills an empty checklist', () => {
    expect(answersFillChecklist([], [])).toBe(false);
  });
});

describe('photoIdsOf', () => {
  it('lists each photo once', () => {
    const other = newId();
    expect(
      photoIdsOf([
        { key: 'a', value: [PHOTO, other] },
        { key: 'b', value: [PHOTO] },
        { key: 'c', value: true },
      ]),
    ).toEqual([PHOTO, other]);
  });
});
