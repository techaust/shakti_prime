import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { CompleteResult } from '../ai/provider';
import { fakeReply } from '../ai/transport';
import {
  extractWithModel,
  extractWorkbook,
  KNOWLEDGE_EXTRACT_MAX_TOKENS,
  KNOWLEDGE_EXTRACT_SYSTEM,
  knowledgeSourceType,
  needsModel,
} from './extract';

// The vault's readers, without a network or a database: a workbook made here, the model a
// stand-in that answers as the provider wrapper does. Every text is synthetic.

const answer = (text: string, stopped: CompleteResult['stopped'] = 'finished'): CompleteResult => {
  const reply = fakeReply(text);
  return { text, model: 'claude-haiku-4-5-20251001', usage: reply.usage, costPaise: 1, stopped };
};

describe('knowledgeSourceType', () => {
  it('names each type the vault takes, and no other', () => {
    expect(knowledgeSourceType('application/pdf')).toBe('pdf');
    expect(knowledgeSourceType('image/webp')).toBe('photo');
    expect(
      knowledgeSourceType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('word');
    expect(
      knowledgeSourceType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe('excel');
    expect(knowledgeSourceType('text/csv')).toBeUndefined();
    expect(needsModel('pdf')).toBe(true);
    expect(needsModel('photo')).toBe(true);
    expect(needsModel('word')).toBe(false);
    expect(needsModel('excel')).toBe(false);
  });
});

describe('extractWorkbook', () => {
  it('reads every sheet in turn, each row on a line with its cells joined', async () => {
    const book = new ExcelJS.Workbook();
    book
      .addWorksheet('Pumps')
      .addRows([
        ['Model', 'Head', 'Power'],
        ['Submersible', '120 m', '5 HP'],
        [],
        ['Surface', null, '2 HP'],
      ]);
    book.addWorksheet('Empty');
    book.addWorksheet('Panels').addRows([
      ['Module', 'Watts'],
      ['Mono perc', 540],
    ]);
    const text = await extractWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
    // The guarded reader is not given the workbook's relationships, so a sheet is named by its
    // place in the file (Sheet1, Sheet3), never by its tab's name.
    expect(text).toBe(
      [
        'Sheet1',
        'Model | Head | Power',
        'Submersible | 120 m | 5 HP',
        'Surface | 2 HP',
        '',
        'Sheet3',
        'Module | Watts',
        'Mono perc | 540',
      ].join('\n'),
    );
  });

  it('calls a file that is not a workbook unreadable', async () => {
    await expect(extractWorkbook(new TextEncoder().encode('Model,Head'))).rejects.toMatchObject({
      reason: 'knowledge_unreadable',
    });
  });
});

describe('extractWithModel', () => {
  const pdf = { mediaType: 'image/jpeg' as const, bytes: new Uint8Array([255, 216, 255, 217]) };

  it('sends the file with the vault’s own instructions and answers the text', async () => {
    const calls: unknown[] = [];
    const text = await extractWithModel((call) => {
      calls.push(call);
      return Promise.resolve(answer('Warranty: five years on the motor.'));
    }, [pdf]);
    expect(text).toBe('Warranty: five years on the motor.');
    expect(calls).toEqual([
      expect.objectContaining({
        system: KNOWLEDGE_EXTRACT_SYSTEM,
        documents: [pdf],
        maxTokens: KNOWLEDGE_EXTRACT_MAX_TOKENS,
      }),
    ]);
  });

  it('calls a refusal unreadable, and an answer cut short too long', async () => {
    await expect(
      extractWithModel(() => Promise.resolve(answer('', 'refused')), [pdf]),
    ).rejects.toMatchObject({ reason: 'knowledge_unreadable' });
    await expect(
      extractWithModel(() => Promise.resolve(answer('Page one', 'too_long')), [pdf]),
    ).rejects.toMatchObject({ reason: 'knowledge_too_long' });
  });
});
