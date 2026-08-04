import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const reviewedApplyMetricsCall = `                await this.applyDeviceMetricsOverride(page);`

const patchedApplyMetricsCall = `                try {
                    await this.applyDeviceMetricsOverride(page);
                }
                catch (error) {
                    this.logger.warn({ error }, "[CDPService] Target closed while applying device metrics; skipping target setup");
                    return;
                }`

export function patchSteelTargetResilience(source) {
  const firstIndex = source.indexOf(reviewedApplyMetricsCall)
  if (
    firstIndex < 0 ||
    source.indexOf(reviewedApplyMetricsCall, firstIndex + reviewedApplyMetricsCall.length) >= 0 ||
    source.includes(patchedApplyMetricsCall)
  ) {
    throw new Error('Steel target resilience did not match the reviewed Steel build')
  }

  return source.replace(reviewedApplyMetricsCall, patchedApplyMetricsCall)
}

async function patchPinnedSteelBuild() {
  const cdpServicePath = path.join(
    '/app/api/build',
    'services/cdp/cdp.service.js',
  )
  const source = await readFile(cdpServicePath, 'utf8')
  await writeFile(cdpServicePath, patchSteelTargetResilience(source))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await patchPinnedSteelBuild()
}
