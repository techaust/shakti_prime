import mammoth from 'mammoth';

/**
 * A Word document's text (`.docx`, BLUEPRINT §9.1: office files are parsed on the server), one
 * paragraph to a line with a blank line between, as `mammoth` reads it: no picture, link target or
 * hidden field. The file checks have already checked its ZIP structure and unpacked size.
 */
export async function readWordText(bytes: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  });
  return result.value;
}
