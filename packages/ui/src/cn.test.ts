import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('keeps a type size next to a text colour', () => {
    expect(cn('text-h3', 'text-text')).toBe('text-h3 text-text');
    expect(cn('text-caption', 'text-text-muted')).toBe('text-caption text-text-muted');
  });

  it('lets a later class of the same kind win, token names included', () => {
    expect(cn('text-h3', 'text-caption')).toBe('text-caption');
    expect(cn('h-control', 'h-8')).toBe('h-8');
    expect(cn('bg-accent', 'bg-highlight')).toBe('bg-highlight');
    expect(cn('max-w-form', 'max-w-detail')).toBe('max-w-detail');
  });
});
