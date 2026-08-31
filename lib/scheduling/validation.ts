import { z } from 'zod'
import { isValidIanaTimeZone } from '@/lib/calendar/time'
import {
  SCHEDULING_DEFAULT_PUBLIC_RANGE_DAYS,
  SCHEDULING_MAX_PUBLIC_RANGE_DAYS,
  SCHEDULING_SLUG_PATTERN,
} from './constants'

export const schedulingSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(SCHEDULING_SLUG_PATTERN)

export const schedulingWeeklyWindowSchema = z.strictObject({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
}).refine((value) => value.endMinute > value.startMinute, {
  message: 'O fim da janela precisa ser posterior ao início.',
})

export const schedulingPageInputSchema = z.strictObject({
  slug: schedulingSlugSchema,
  enabled: z.boolean(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable(),
  durationMinutes: z.number().int().min(5).max(480),
  slotIntervalMinutes: z.number().int().min(5).max(480),
  bufferBeforeMinutes: z.number().int().min(0).max(1440),
  bufferAfterMinutes: z.number().int().min(0).max(1440),
  minimumNoticeMinutes: z.number().int().min(0).max(43_200),
  maximumAdvanceDays: z.number().int().min(1).max(365),
  weeklyWindows: z.array(schedulingWeeklyWindowSchema).max(35),
}).superRefine((value, context) => {
  const sorted = [...value.weeklyWindows].sort((a, b) =>
    a.weekday - b.weekday || a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  )
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    if (current.weekday === previous.weekday && current.startMinute < previous.endMinute) {
      context.addIssue({
        code: 'custom',
        path: ['weeklyWindows'],
        message: 'Há janelas de disponibilidade sobrepostas.',
      })
      return
    }
  }
})

export const publicSchedulingParamsSchema = z.strictObject({
  slug: schedulingSlugSchema,
})

export const publicSlotsQuerySchema = z.strictObject({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().int().min(1).max(SCHEDULING_MAX_PUBLIC_RANGE_DAYS)
    .default(SCHEDULING_DEFAULT_PUBLIC_RANGE_DAYS),
  timeZone: z.string().trim().min(1).max(100).refine(isValidIanaTimeZone),
})

const absoluteInstantSchema = z.string().trim().max(64).refine((value) => {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false
  return Number.isFinite(new Date(value).getTime())
}, 'Informe um instante ISO com fuso horário.')

export const publicBookingInputSchema = z.strictObject({
  startsAt: absoluteInstantSchema,
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  timeZone: z.string().trim().min(1).max(100).refine(isValidIanaTimeZone),
  phone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
  hp: z.literal('').optional(),
})

export type SchedulingPageInput = z.infer<typeof schedulingPageInputSchema>
export type PublicBookingInput = z.infer<typeof publicBookingInputSchema>
