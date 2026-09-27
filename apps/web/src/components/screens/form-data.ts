/** A text field of a submitted form, trimmed; an empty string when it is absent or a file. */
export function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
