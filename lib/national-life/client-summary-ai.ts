import 'server-only'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import type { ClientSummary } from './client-summary'
import { analyzeClientPolicy } from './client-summary-insights'

const selection = z.object({
  focus: z.enum(['PROTECTION', 'CASH_VALUE', 'SURRENDER_TIMING', 'BALANCED']),
  highlightYears: z.array(z.number().int().positive()).min(2).max(6),
})

export type ClientSummaryInterpretation = z.infer<typeof selection> & {
  source: 'AI' | 'RULES'
}

export function defaultClientSummaryInterpretation(summary: ClientSummary): ClientSummaryInterpretation {
  if (summary.kind !== 'PROJECTED') return { focus: 'PROTECTION', highlightYears: [], source: 'RULES' }
  const analysis = analyzeClientPolicy(summary)
  const firstYear = summary.coverage[0]?.policyYear
  const lastYear = summary.coverage.at(-1)?.policyYear
  return {
    focus: analysis?.breakEven ? 'SURRENDER_TIMING' : 'BALANCED',
    highlightYears: [...new Set([
      firstYear,
      ...(analysis?.checkpoints.map((point) => point.policyYear) ?? []),
      lastYear,
    ].filter((year): year is number => year !== undefined))].slice(0, 6),
    source: 'RULES',
  }
}

/// The model prioritizes verified carrier facts; it never writes client-facing
/// numbers or prose. Unsupported years are rejected before the renderer sees
/// them, and any provider failure falls back to the deterministic analysis.
export async function interpretClientSummary(
  summary: ClientSummary,
): Promise<ClientSummaryInterpretation> {
  const fallback = defaultClientSummaryInterpretation(summary)
  if (summary.kind !== 'PROJECTED' || !process.env.OPENAI_API_KEY) return fallback

  const analysis = analyzeClientPolicy(summary)
  const availableYears = summary.coverage.map((point) => point.policyYear)
  if (availableYears.length < 2) return fallback
  const model = process.env.KBOT_ILLUSTRATION_MODEL || 'gpt-4o-mini'
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 20_000 })
  try {
    const response = await client.responses.create({
      model,
      store: false,
      max_output_tokens: 120,
      instructions:
        'Select the most useful policy years and the primary client decision theme. ' +
        'All values are verified National Life illustration data. Do not calculate, advise, ' +
        'recommend surrender, or introduce facts. Select only years present in availableYears. ' +
        'Prefer years that reveal changes in protection, cash value, or the deterministic break-even.',
      input: JSON.stringify({
        availableYears,
        points: summary.coverage.map((point) => ({
          year: point.policyYear,
          age: point.age,
          deathBenefit: point.netDeathBenefit,
          cashSurrenderValue: point.cashSurrenderValue,
        })),
        deterministicBreakEvenYear: analysis?.breakEven?.policyYear ?? null,
      }),
      text: { format: zodTextFormat(selection, 'client_summary_selection') },
    })
    if (response.status !== 'completed') return fallback
    const parsed = selection.safeParse(JSON.parse(response.output_text))
    if (!parsed.success) return fallback
    const allowed = new Set(availableYears)
    const highlightYears = [...new Set(parsed.data.highlightYears)].filter((year) => allowed.has(year))
    if (highlightYears.length < 2) return fallback
    return { ...parsed.data, highlightYears, source: 'AI' }
  } catch {
    return fallback
  }
}
