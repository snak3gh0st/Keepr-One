"use client"

import { useI18n } from '@/components/i18n/LanguageProvider'
import type { KBotContactRow, KBotContactState } from '@/lib/kbot-messaging/contact-list'

/// Iniciais para o disco da linha. Duas letras no máximo: com nomes como
/// "A ALBUQUERQUE MONTEIRO" o terceiro caractere não distingue nada e só
/// aperta o disco.
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]![0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : ''
  return (first + last).toUpperCase()
}

/// O telefone é o segundo dado da linha, não um detalhe escondido: é ele que
/// o agente compara com a ficha quando a linha diz que falta alguma coisa.
/// Só agrupa o que sabe ler: um +55 com DDD e 8 ou 9 dígitos. Qualquer outro
/// número sai como está gravado — cortar "+1 555..." em "+15 55..." seria
/// mentir justamente na tela feita para conferir o número.
function readablePhone(phone: string) {
  const digits = phone.replace(/[^\d+]/g, '')
  if (!/^\+55\d{10,11}$/.test(digits)) return phone
  return `${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, -4)}-${digits.slice(-4)}`
}

/// Estados que o agente pode resolver hoje ganham o tom de atenção (gold);
/// os que ele não resolve na lista ficam neutros. `STOPPED` é uma escolha do
/// cliente respeitada, não um erro — nunca entra em vermelho.
const ATTENTION: ReadonlySet<KBotContactState> = new Set(['COUNTRY_REQUIRED', 'INVALID_PHONE'])

export function KBotContactList({
  rows,
  onToggle,
}: {
  rows: readonly KBotContactRow[]
  onToggle: (input: { clientId: string; enabled: boolean }) => void
}) {
  const { copy } = useI18n()

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border-steel bg-paper px-4 py-8 text-center text-sm text-ink-muted">
        {/* Vale para a busca sem resultado e para o agente sem nenhum
            contato: a lista não sabe qual dos dois é. */}
        {copy('Nenhum contato para mostrar.', 'No contacts to show.')}
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border-steel bg-paper">
      <div className="flex items-center justify-between gap-3 border-b border-border-steel bg-panel px-3 py-2 sm:px-4">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-ink-muted">
          {copy('Contato', 'Contact')}
        </p>
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-ink-muted">K-Bot</p>
      </div>

      <ul className="divide-y divide-border-steel/70">
        {rows.map((row) => {
          const toggleable = row.state === 'ON' || row.state === 'OFF'
          const on = row.state === 'ON'
          const attention = ATTENTION.has(row.state)
          return (
            <li
              key={row.id}
              className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-teal-pale/35 sm:px-4"
            >
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-full border border-border-steel bg-panel text-[0.7rem] font-bold text-ink-muted"
              >
                {initials(row.name)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{row.name}</p>
                <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-5">
                  {row.phone && (
                    <span className="font-mono text-ink-muted">{readablePhone(row.phone)}</span>
                  )}
                  {row.state === 'NO_PHONE' && (
                    <span className="text-ink-muted">
                      {copy('Sem telefone — o K-Bot não tem por onde falar.', 'No phone — K-Bot has no way to reach them.')}
                    </span>
                  )}
                  {/* Há telefone; falta o país. Dizer "sem telefone" aqui mandaria o
                      agente procurar um número que já está na ficha. */}
                  {row.state === 'COUNTRY_REQUIRED' && (
                    <span className="text-gold-ink">
                      {copy('Falta o código do país — adicione o código do país ao telefone.', 'Missing country code — add the country code to the phone number.')}
                    </span>
                  )}
                  {row.state === 'INVALID_PHONE' && (
                    <span className="text-gold-ink">
                      {copy('Telefone inválido — corrija o número.', 'Invalid phone — correct the number.')}
                    </span>
                  )}
                  {row.state === 'STOPPED' && (
                    <span className="text-ink-muted">
                      {copy('Pediu para não receber.', 'Asked not to be contacted.')}
                    </span>
                  )}
                </p>
              </div>

              {toggleable ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={row.name}
                  onClick={() => onToggle({ clientId: row.id, enabled: !on })}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center px-1"
                >
                  <span
                    aria-hidden="true"
                    className={`relative block h-6 w-11 rounded-full border transition-colors duration-200 ${
                      on ? 'border-teal-deep bg-teal' : 'border-border-steel bg-border-steel'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 size-4.5 rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none ${
                        on ? 'translate-x-[1.375rem]' : 'translate-x-0'
                      }`}
                    />
                  </span>
                </button>
              ) : (
                <span
                  className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${
                    attention
                      ? 'border-gold/40 bg-gold-pale text-gold-ink'
                      : 'border-border-steel bg-panel text-ink-muted'
                  }`}
                >
                  {/* A etiqueta diz o que fazer; a linha abaixo do nome diz o
                      quê. Repetir a frase aqui só encheria a coluna. */}
                  {attention && copy('Ajustar', 'Fix')}
                  {row.state === 'NO_PHONE' && copy('Sem número', 'No number')}
                  {row.state === 'STOPPED' && copy('Não receber', 'Opted out')}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
