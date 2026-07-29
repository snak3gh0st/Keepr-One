import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import {
  createNationalLifeRuntimeDeps,
  runNationalLifeRuntime,
} from '../workers/national-life/runtime'

async function main() {
  const env = getNationalLifeEnv()
  await runNationalLifeRuntime(createNationalLifeRuntimeDeps(env))
}

void main()
  .catch(() => {
    console.error('National Life runtime failed to start')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
