'use client'

import { useState } from 'react'
import { submitPolicyImport, submitCommissionImport } from './actions'
import { Button } from '@/components/Button'
import type { ImportStatus } from '@/lib/csv/import-service'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { LocalizedImportStatusPill } from '../LocalizedStatusPills'
import { formatNumber } from '@/lib/i18n/format'

type Result = {
  batchId: string
  status: ImportStatus
  successCount: number
  warnings?: string[]
  errors: { row: number; message: string }[]
}

function ImportResultSummary({ result }: { result: Result }) {
  const { copy, language } = useI18n()
  const importedLabel = result.successCount === 1
    ? copy('1 linha importada', '1 row imported')
    : copy(`${formatNumber(result.successCount, language)} linhas importadas`, `${formatNumber(result.successCount, language)} rows imported`)
  const errorLabel = result.errors.length === 1
    ? copy('1 erro', '1 error')
    : copy(`${formatNumber(result.errors.length, language)} erros`, `${formatNumber(result.errors.length, language)} errors`)
  return (
    <div className="mt-4 rounded-lg border border-border-steel bg-panel/50 px-4 py-3 text-sm">
      <div className="flex items-center gap-2">
        <LocalizedImportStatusPill status={result.status} />
        <p className="font-semibold text-ink">
          {importedLabel}, {errorLabel}.
        </p>
      </div>
      {result.warnings?.map((warning) => <p key={warning} className="mt-2 text-ink-muted">{warning}</p>)}
      {result.errors.length > 0 && (
        <ul aria-live="polite" className="mt-1.5 list-disc pl-4 text-ink">
          {result.errors.map((e) => (
            <li key={e.row}>
              {copy(`Linha ${formatNumber(e.row, language)}`, `Row ${formatNumber(e.row, language)}`)}: {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ImportCard({
  title,
  action,
  buttonLabel,
  buttonVariant = 'secondary',
  hint,
}: {
  title: string
  action: (formData: FormData) => Promise<Result>
  buttonLabel: string
  buttonVariant?: 'primary' | 'secondary'
  hint?: string
}) {
  const { copy } = useI18n()
  const [result, setResult] = useState<Result | null>(null)
  const [submitting, setSubmitting] = useState(false)

  return (
    <section className="rounded-lg border border-border-steel bg-paper p-5 transition-colors hover:border-ink-muted">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <span className="rounded-md bg-teal-pale px-2 py-1 text-[11px] font-semibold text-teal">CSV</span>
      </div>
      {hint && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
      <form
        action={async (formData: FormData) => {
          setSubmitting(true)
          try {
            setResult(await action(formData))
          } finally {
            setSubmitting(false)
          }
        }}
        className="mt-5 flex flex-wrap items-center gap-3"
      >
        <input
          type="file"
          name="file"
          accept=".csv"
          required
          aria-label={copy('Arquivo CSV', 'CSV file')}
          className="text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-teal-pale file:px-3 file:py-2 file:text-sm file:font-semibold file:text-teal hover:file:bg-teal/20"
        />
        <Button type="submit" variant={buttonVariant} disabled={submitting}>
          {submitting ? copy('Importando…', 'Importing…') : buttonLabel}
        </Button>
      </form>
      {result && <ImportResultSummary result={result} />}
    </section>
  )
}

export function ImportForms() {
  const { copy } = useI18n()
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ImportCard
        title={copy('1. Apólices (CSV)', '1. Policies (CSV)')}
        action={submitPolicyImport}
        buttonLabel={copy('Importar apólices', 'Import policies')}
        buttonVariant="primary"
        hint={copy(
          'Coluna opcional lastPaymentDate (data do último pagamento): sem ela, apólices em vigor sem data de vigência aparecem como "sem sinal de pagamento" nos alertas de risco do agente.',
          'Optional lastPaymentDate column: without it, active policies with no effective date appear as "no payment signal" in the agent\'s risk alerts.',
        )}
      />
      <ImportCard
        title={copy('2. Comissões (CSV)', '2. Commissions (CSV)')}
        action={submitCommissionImport}
        buttonLabel={copy('Importar comissões', 'Import commissions')}
        hint={copy(
          'Importe as apólices primeiro — cada linha de comissão procura a apólice pelo número, e falha se ela ainda não existir.',
          'Import policies first — each commission row looks up the policy by number and fails if the policy does not exist yet.',
        )}
      />
    </div>
  )
}
