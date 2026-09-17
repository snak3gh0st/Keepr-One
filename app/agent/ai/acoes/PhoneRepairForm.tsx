'use client'

import { useState } from 'react'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { reviewedPhone } from '@/lib/kbot-followup/contact-quality'

export function PhoneRepairForm({ initialPhone, busy, onSave, onCancel }: {
  initialPhone?: string | null; busy: boolean; onSave: (phone: string) => void; onCancel: () => void
}) {
  const { copy } = useI18n()
  const [value, setValue] = useState(initialPhone ?? '')
  const [country, setCountry] = useState<'' | '1' | '55'>('')
  const [invalid, setInvalid] = useState(false)
  const phone = reviewedPhone(value, country)
  const field = 'min-h-11 rounded-lg border border-border-steel bg-panel px-3 text-sm text-ink'
  return <form className="mt-3 rounded-xl border border-border-steel bg-paper p-4" onSubmit={e => {
    e.preventDefault()
    if (!phone) { setInvalid(true); return }
    onSave(phone)
  }}>
    <div className="grid max-w-xl gap-3 sm:grid-cols-2">
      <label className="grid gap-2 text-sm text-ink">{copy('Código do país', 'Country code')}
        <select disabled={busy} className={field} value={country} onChange={e => { setCountry(e.target.value as typeof country); setInvalid(false) }}>
          <option value="">{copy('Informar número com +DDI', 'Enter number with +country code')}</option>
          <option value="1">+1 · {copy('EUA / Canadá', 'USA / Canada')}</option>
          <option value="55">+55 · Brasil</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm text-ink">{copy('Telefone com código do país', 'Phone with country code')}
        <input autoFocus required disabled={busy} type="tel" autoComplete="tel" maxLength={40} placeholder={country ? copy('DDD + número', 'Area code + number') : '+…'} className={field} value={value} onChange={e => { setValue(e.target.value); setInvalid(false) }} aria-invalid={invalid} />
      </label>
    </div>
    <p className="mt-3 text-sm tabular-nums text-ink" aria-live="polite">{phone ? <>{copy('Será salvo como', 'Will be saved as')} <strong>{phone}</strong></> : copy('Confirme o país e o telefone. Para outros países, inclua + e o DDI no número.', 'Confirm the country and phone. For other countries, include + and the country code in the number.')}</p>
    {invalid && <p role="alert" className="mt-2 text-sm text-danger">{copy('Confira o DDI e a quantidade de dígitos do telefone.', 'Check the country code and number of phone digits.')}</p>}
    <p className="mt-2 text-xs text-ink-muted">{copy('Salvar atualiza o cadastro na Keepr One e não envia mensagem.', 'Saving updates the Keepr One record and sends no message.')}</p>
    <div className="mt-3 flex flex-wrap gap-2"><button className="min-h-11 rounded-xl bg-rail-strong px-4 text-sm font-semibold text-paper disabled:opacity-40" disabled={busy}>{copy('Salvar telefone', 'Save phone')}</button><button type="button" className="min-h-11 rounded-xl border border-border-steel px-4 text-sm text-ink" disabled={busy} onClick={onCancel}>{copy('Cancelar', 'Cancel')}</button></div>
  </form>
}
