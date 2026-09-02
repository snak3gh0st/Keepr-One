import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { prisma } from '@/lib/prisma'
import {
  sendChangeEmailConfirmationEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
} from '@/lib/email/send'
import { createRedisSecondaryStorage } from '@/lib/redis/secondary-storage'
import { allowLocalEmailChangeWithoutVerification } from '@/lib/email-change-config'
import { z } from 'zod'
import { normalizeLanguage } from '@/lib/i18n/config'

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

const secondaryStorage = createRedisSecondaryStorage()
const localEmailChangePreview = allowLocalEmailChangeWithoutVerification()

export const auth = betterAuth({
  baseURL,
  trustedOrigins,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secondaryStorage,
  rateLimit: {
    enabled: true,
    // An absent Redis adapter cannot back a limiter. Keep a per-process
    // fallback in development/single-instance installs instead of silently
    // treating every request as the first one.
    storage: secondaryStorage ? 'secondary-storage' : 'memory',
    window: 60,
    max: 20,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/request-password-reset': { window: 300, max: 3 },
      '/verify-password': { window: 900, max: 5 },
      '/change-email': { window: 900, max: 5 },
      '/change-password': { window: 900, max: 5 },
    },
  },
  emailAndPassword: {
    enabled: true,
    // Accounts are provisioned only by controlled product flows (currently
    // the invite-gated Founder registration). The generic Better Auth signup
    // endpoint must not bypass those rules.
    disableSignUp: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendResetPasswordEmail({
        to: user.email,
        resetUrl: url,
        language: normalizeLanguage((user as typeof user & { language?: unknown }).language) ?? 'PT',
      })
    },
  },
  emailVerification: {
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      if (localEmailChangePreview && !process.env.RESEND_API_KEY) return
      await sendVerificationEmail({
        to: user.email,
        verificationUrl: url,
        language: normalizeLanguage((user as typeof user & { language?: unknown }).language) ?? 'PT',
      })
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      // The login identity moves only after the new inbox proves ownership.
      // Existing verified accounts also approve the request from their current
      // inbox before Better Auth sends the second message to the new address.
      updateEmailWithoutVerification: localEmailChangePreview,
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        await sendChangeEmailConfirmationEmail({
          to: user.email,
          newEmail,
          confirmationUrl: url,
          language: normalizeLanguage((user as typeof user & { language?: unknown }).language) ?? 'PT',
        })
      },
    },
    additionalFields: {
      // Never accept authorization roles from a public auth request body.
      role: { type: 'string', required: true, defaultValue: 'AGENT', input: false },
      language: {
        type: 'string',
        required: true,
        defaultValue: 'PT',
        validator: { input: z.enum(['PT', 'EN']) },
      },
    },
  },
  // Server Actions need this bridge to persist Set-Cookie headers produced by
  // operations such as changePassword({ revokeOtherSessions: true }). Better
  // Auth requires the cookie bridge to be the final plugin.
  plugins: [nextCookies()],
})
