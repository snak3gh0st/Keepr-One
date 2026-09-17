"use client"

import { useI18n } from '@/components/i18n/LanguageProvider'
import type { KBotContactRow } from '@/lib/kbot-messaging/contact-list'

export function KBotContactList({
  rows,
  onToggle,
}: {
  rows: readonly KBotContactRow[]
  onToggle: (input: { clientId: string; enabled: boolean }) => void
}) {
  const { copy } = useI18n()
  return (
    <ul className="divide-y divide-border-steel">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-sm font-medium text-ink">{row.name}</p>
            {row.state === 'NO_PHONE' && (
              <p className="text-xs text-ink-muted">
                {copy('Sem telefone — o K-Bot não tem por onde falar.', 'No phone — K-Bot has no way to reach them.')}
              </p>
            )}
            {/* Há telefone; falta o país. Dizer "sem telefone" aqui mandaria o
                agente procurar um número que já está na ficha. */}
            {row.state === 'COUNTRY_REQUIRED' && (
              <p className="text-xs text-ink-muted">
                {copy('Falta o código do país — adicione o código do país ao telefone.', 'Missing country code — add the country code to the phone number.')}
              </p>
            )}
            {row.state === 'INVALID_PHONE' && (
              <p className="text-xs text-ink-muted">
                {copy('Telefone inválido — corrija o número.', 'Invalid phone — correct the number.')}
              </p>
            )}
            {row.state === 'STOPPED' && (
              <p className="text-xs text-ink-muted">
                {copy('Pediu para não receber.', 'Asked not to be contacted.')}
              </p>
            )}
          </div>
          {(row.state === 'ON' || row.state === 'OFF') && (
            <button
              type="button"
              role="switch"
              aria-checked={row.state === 'ON'}
              aria-label={row.name}
              onClick={() => onToggle({ clientId: row.id, enabled: row.state === 'OFF' })}
              className="rounded-full border border-border-steel px-3 py-1 text-xs text-ink"
            >
              {row.state === 'ON' ? copy('Ligado', 'On') : copy('Desligado', 'Off')}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
