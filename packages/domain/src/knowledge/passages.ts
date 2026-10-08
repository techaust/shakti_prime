import { maskForModel, MODEL_TEXT_LIMIT } from '../privacy/model-text';
import { chunkText, normaliseText } from './chunk';

/** The longest block masked in one piece: well under `MODEL_TEXT_LIMIT`, which truncates. */
const BLOCK_CHARS = MODEL_TEXT_LIMIT / 2;
/** Characters either side of a cut that must hold no digit, so a cut never falls inside a number. */
const DIGIT_MARGIN = 6;

const DIGIT = /\p{Nd}/u;

/** Whether cutting a line at `index` (a space) leaves digits close on both sides of the cut. */
function insideNumber(line: string, index: number): boolean {
  return (
    DIGIT.test(line.slice(Math.max(0, index - DIGIT_MARGIN), index)) &&
    DIGIT.test(line.slice(index + 1, index + 1 + DIGIT_MARGIN))
  );
}

/** A line of more than `BLOCK_CHARS` characters in pieces cut at spaces that are not inside a number. */
function cutLine(line: string): string[] {
  if (line.length <= BLOCK_CHARS) return [line];
  const out: string[] = [];
  let rest = line;
  while (rest.length > BLOCK_CHARS) {
    let at = rest.lastIndexOf(' ', BLOCK_CHARS);
    while (at > 0 && insideNumber(rest, at)) at = rest.lastIndexOf(' ', at - 1);
    if (at <= 0) at = BLOCK_CHARS;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (rest !== '') out.push(rest);
  return out;
}

/**
 * The text with its personal numbers masked (`maskForModel`) before it is cut into passages: in
 * blocks of whole lines under the masker's own limit, so a number is masked whole whatever line or
 * passage it would later fall on. A block never ends where a number may continue on the next line.
 */
export function maskWholeText(text: string): string {
  const lines = normaliseText(text).split('\n').flatMap(cutLine);
  const blocks: string[] = [];
  let block: string[] = [];
  let size = 0;
  const flush = () => {
    if (block.length > 0) blocks.push(block.join('\n'));
    block = [];
    size = 0;
  };
  for (const line of lines) {
    if (size + line.length + 1 > BLOCK_CHARS && block.length > 0) {
      // Carry a trailing line that ends in a digit into the next block, so a number wrapped
      // across the two lines is read whole by one masking.
      const last = block.at(-1) ?? '';
      if (DIGIT.test(last.slice(-DIGIT_MARGIN)) && DIGIT.test(line.slice(0, DIGIT_MARGIN))) {
        block.pop();
        flush();
        block.push(last);
        size = last.length + 1;
      } else {
        flush();
      }
    }
    block.push(line);
    size += line.length + 1;
  }
  flush();
  return blocks.map(maskForModel).join('\n');
}

/**
 * A vault file's passages as they are stored and sent to the embedding model: the text masked
 * whole (`maskWholeText`), cut (`chunkText`), and every passage masked again as a second layer.
 */
export function knowledgePassages(text: string): string[] {
  return chunkText(maskWholeText(text)).map(maskForModel);
}
