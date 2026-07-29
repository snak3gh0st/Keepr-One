import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const reviewedQuality = 'quality: 75'
const patchedQuality = 'quality: 92'

export function patchSteelScreencastQuality(source) {
  const firstIndex = source.indexOf(reviewedQuality)
  if (firstIndex < 0 || source.indexOf(reviewedQuality, firstIndex + reviewedQuality.length) >= 0) {
    throw new Error('Steel screencast quality did not match the reviewed Steel build')
  }
  return source.replace(reviewedQuality, patchedQuality)
}

async function patchPinnedSteelBuild() {
  const castingHandlerPath = path.join(
    '/app/api/build',
    'plugins/browser-socket/casting.handler.js',
  )
  const source = await readFile(castingHandlerPath, 'utf8')
  await writeFile(castingHandlerPath, patchSteelScreencastQuality(source))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await patchPinnedSteelBuild()
}
