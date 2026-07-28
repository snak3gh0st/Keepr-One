import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from '@/lib/prisma'

const configuredBaseURL = process.env.BETTER_AUTH_URL
const localBaseURL = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : undefined
const baseURL = configuredBaseURL ?? localBaseURL

const trustedOrigins = [
  configuredBaseURL,
  process.env.NEXT_PUBLIC_APP_URL,
  ...(process.env.NODE_ENV === 'development'
    ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : []),
].filter((origin): origin is string => Boolean(origin))

export const auth = betterAuth({
  baseURL,
  trustedOrigins,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: { type: 'string', required: true, defaultValue: 'AGENT' },
    },
  },
})
