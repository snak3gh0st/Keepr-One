/** A directory page accepts only a complete positive integer URL value. */
export function parseDirectoryPage(value: string): number {
  if (!/^[0-9]+$/.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}
