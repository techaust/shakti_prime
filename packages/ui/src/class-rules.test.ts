import { describe, expect, it } from 'vitest';
import { tokenBypasses } from './class-rules';

describe('tokenBypasses', () => {
  it('finds bracketed colours, type sizes, weights, radii and spaces', () => {
    expect(
      tokenBypasses(
        'bg-[#fff] text-[13px] font-[510] leading-[18px] rounded-[5px] p-[7px] -mt-[2px] max-md:w-[300px] gap-x-[3px] min-h-[65px] backdrop-blur-[2px]',
      ),
    ).toEqual([
      'bg-[#fff]',
      'text-[13px]',
      'font-[510]',
      'leading-[18px]',
      'rounded-[5px]',
      'p-[7px]',
      '-mt-[2px]',
      'w-[300px]',
      'gap-x-[3px]',
      'min-h-[65px]',
      'backdrop-blur-[2px]',
    ]);
  });

  it('finds the weights docs/08-design-system.md §3 does not use', () => {
    expect(tokenBypasses('font-bold font-light font-medium font-semibold font-normal')).toEqual([
      'font-bold',
      'font-light',
    ]);
  });

  it('leaves token utilities, state variants and layout templates alone', () => {
    expect(
      tokenBypasses(
        'text-h1 font-medium rounded-md p-3 h-control data-[state=open]:animate-dialog-in has-[:checked]:bg-surface grid-cols-[minmax(0,2fr)_auto] [&_svg]:size-4 aria-[current=page]:text-text',
      ),
    ).toEqual([]);
  });

  it('reads classes in quotes, template strings and after a variant', () => {
    expect(tokenBypasses(`className="w-[1px]" 'h-[2px]' \`top-[3px]\` hover:m-[4px]`)).toEqual([
      'w-[1px]',
      'h-[2px]',
      'top-[3px]',
      'm-[4px]',
    ]);
  });
});
