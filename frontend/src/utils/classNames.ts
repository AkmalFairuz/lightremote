/** Joins conditional CSS classes without hiding the conditions in a template string. */
export function classNames(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
