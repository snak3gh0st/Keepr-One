import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const reviewedScreencastCall = `await targetClient.send("Page.startScreencast", {
                    format: "jpeg",
                    quality: 75,
                    maxWidth: width,
                    maxHeight: height,
                });`

const patchedScreencastCall = `await targetClient.send("Page.startScreencast", {
                    format: "jpeg",
                    quality: 92,
                    maxWidth: width,
                    maxHeight: height,
                });`

export function patchSteelScreencastQuality(source) {
  const firstIndex = source.indexOf(reviewedScreencastCall)
  if (
    firstIndex < 0 ||
    source.indexOf(reviewedScreencastCall, firstIndex + reviewedScreencastCall.length) >= 0 ||
    countOccurrences(source, 'Page.startScreencast') !== 1
  ) {
    throw new Error('Steel screencast quality did not match the reviewed Steel build')
  }
  return source.replace(reviewedScreencastCall, patchedScreencastCall)
}

function countOccurrences(source, target) {
  return source.split(target).length - 1
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
