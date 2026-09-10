import 'server-only'

import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import { z } from 'zod'

const phoneError = 'Informe um telefone válido dos Estados Unidos, com código de área.'

/**
 * Validate the complete input before parsing: phone parsers can otherwise
 * extract a valid number from text or accept an extension we do not collect.
 * Country metadata also excludes Canadian/Caribbean numbers sharing +1.
 */
export function normalizeUsPhone(value: string): string | null {
  const input = value.trim()
  if (!input || input.length > 32 || !/^\+?[\d()\s.-]+$/.test(input)) {
    return null
  }

  const digits = input.replace(/\D/g, '')
  if (!/^\d{10}$/.test(digits) && !/^1\d{10}$/.test(digits)) {
    return null
  }

  const phone = parsePhoneNumberFromString(input, {
    defaultCountry: 'US',
    extract: false,
  })

  return phone?.country === 'US' && phone.isValid() ? phone.number : null
}

export const founderLeadSchema = z.object({
  name: z.string().trim()
    .min(2, 'Informe seu nome completo.')
    .max(100, 'O nome deve ter no máximo 100 caracteres.'),
  email: z.string().trim().toLowerCase()
    .email('Informe um e-mail válido.')
    .max(254, 'O e-mail deve ter no máximo 254 caracteres.'),
  phone: z.string().transform((value, context) => {
    const normalized = normalizeUsPhone(value)
    if (!normalized) {
      context.addIssue({ code: 'custom', message: phoneError })
      return z.NEVER
    }
    return normalized
  }),
})

export type FounderLeadFieldErrors = Partial<Record<'name' | 'email' | 'phone', string[]>>
