import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from '@/lib/prisma'
import { sendResetPasswordEmail } from '@/lib/email/send'

const configuredBaseURL = process.env.BETTER_AUTH_URL
const localBaseURL = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : undefined
const baseURL = configuredBaseURL ?? localBaseURL ?? 'https://app.keeprone.com'

const fallbackTrustedOrigins = [
  'https://app.keeprone.com',
  'https://www.keeprone.com',
  'https://keeprone.com',
]

const trustedOrigins = [
  configuredBaseURL,
  process.env.NEXT_PUBLIC_APP_URL,
  ...fallbackTrustedOrigins,
  ...(process.env.NODE_ENV === 'development'
    ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : []),
].filter((origin): origin is string => Boolean(origin))

export const auth = betterAuth({
  baseURL,
  trustedOrigins,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await sendResetPasswordEmail({ to: user.email, resetUrl: url })
    },
  },
  user: {
    additionalFields: {
      role: { type: 'string', required: true, defaultValue: 'AGENT' },
    },
  },
})
