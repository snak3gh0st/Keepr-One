export function normalizeManifestKey(value: string): string {
  return value.replace(/\s+/g, '')
}
