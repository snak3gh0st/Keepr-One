'use client'

import { useState } from 'react'
import { Button } from '@/components/Button'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { submitAgentLeadImport } from './actions'
import type { CrmLeadImportResult } from '@/lib/crm/lead-import'

export function LeadImportForm() {
  const { copy } = useI18n()
  const [result, setResult] = useState<CrmLeadImportResult | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <form
      action={async (formData) => {
        setPending(true)
        try { setResult(await submitAgentLeadImport(formData)) } finally { setPending(false) }
      }}
      className="module-main-surface"
    >
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">{copy('Importação CRM', 'CRM import')}</p>
      <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">{copy('Importar leads em CSV', 'Import leads from CSV')}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
        {copy('Use as colunas firstName,lastName,email,phone,dateOfBirth,state,tobaccoStatus,objective,productType,targetCoverage,monthlyBudget. Nome, firstName ou name é suficiente; os demais campos recebem padrões seguros.', 'Use firstName,lastName,email,phone,dateOfBirth,state,tobaccoStatus,objective,productType,targetCoverage,monthlyBudget. Name, firstName, or name is enough; the other fields receive safe defaults.')}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input type="file" name="file" accept=".csv,text/csv" required aria-label={copy('Arquivo CSV de leads', 'Lead CSV file')} className="text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-teal-pale file:px-3 file:py-2 file:text-sm file:font-semibold file:text-teal" />
        <Button type="submit" variant="primary" disabled={pending}>{pending ? copy('Importando…', 'Importing…') : copy('Importar leads', 'Import leads')}</Button>
      </div>
      {result && (
        <div className="mt-5 rounded-lg border border-border-steel bg-panel/60 px-4 py-3 text-sm" role={result.status === 'FAILED' ? 'alert' : 'status'}>
          <p className="font-semibold text-ink">{copy(`${result.successCount} lead(s) importado(s), ${result.skippedCount} duplicado(s) ignorado(s).`, `${result.successCount} lead(s) imported, ${result.skippedCount} duplicate(s) skipped.`)}</p>
          {result.warnings.map((warning) => <p key={warning} className="mt-1 text-ink-muted">{warning}</p>)}
          {result.errors.map((error) => <p key={`${error.row}-${error.message}`} className="mt-1 text-danger">{copy(`Linha ${error.row}: ${error.message}`, `Row ${error.row}: ${error.message}`)}</p>)}
        </div>
      )}
    </form>
  )
}
