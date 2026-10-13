import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// The screen's only hooks are the two translators; a key-echo stands in so the component can be
// called as a function and its button's handler read from the returned tree.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const { default: ErrorScreen } = await import('./error');

/** The `onClick` of the element whose text is the retry key. */
function retryHandler(node: ReactNode): (() => void) | undefined {
  if (!isValidElement(node)) {
    if (Array.isArray(node)) {
      for (const child of node as ReactNode[]) {
        const found = retryHandler(child);
        if (found) return found;
      }
    }
    return undefined;
  }
  const props = (node as ReactElement<{ children?: ReactNode; onClick?: () => void }>).props;
  if (props.children === 'retry' && props.onClick) return props.onClick;
  return retryHandler(props.children);
}

describe('the root error screen', () => {
  it('reads the screen again from the server when Try again is pressed', () => {
    const reset = vi.fn();
    const retry = vi.fn();
    const tree = ErrorScreen({ error: new Error('x'), reset, retry });
    retryHandler(tree)?.();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('falls back to clearing the error when the framework gives no retry', () => {
    const reset = vi.fn();
    const tree = ErrorScreen({ error: new Error('x'), reset });
    retryHandler(tree)?.();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
