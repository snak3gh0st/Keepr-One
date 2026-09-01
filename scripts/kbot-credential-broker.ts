import { prisma } from '../lib/prisma'
import { runKBotCredentialBroker } from '../workers/kbot-credential-broker/runtime'

async function main() {
  const server = await runKBotCredentialBroker()
  await new Promise<void>((resolve) => {
    const stop = () => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

void main()
  .catch(() => {
    console.error('K-Bot credential broker failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
