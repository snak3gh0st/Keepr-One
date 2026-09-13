'use client'

import { useState } from 'react'
import { useI18n } from '@/components/i18n/LanguageProvider'

/// Lets the agent choose what goes to the client, and in which language.
///
/// The language here is the *client's*, not the agent's: an agent working in
/// Portuguese may well be sending to an English-speaking insured, so this does
/// not follow the interface language. It defaults to the one the agent is
/// reading, because that is the better guess, and stays a visible choice.
///
/// The presentation is offered only when there is a projection behind it. Term
/// has four numbers and a duration, which is a one-pager; a five-page version
/// of it would be padding.
export function ClientDocumentPicker({
  illustrationId,
  presentationAvailable,
}: {
  illustrationId: string
  presentationAvailable: boolean
}) {
  const { copy, language } = useI18n()
  const [clientLanguage, setClientLanguage] = useState<'PT' | 'EN'>(language === 'PT' ? 'PT' : 'EN')
  const href = (variant: 'quick' | 'full') =>
    `/api/illustrations/${illustrationId}/client-summary?variant=${variant}&lang=${clientLanguage.toLowerCase()}`

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <a
          href={href('quick')}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-teal bg-teal px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-teal-deep"
        >
          {copy('Resumo de uma página', 'One-page summary')}
        </a>
        {presentationAvailable ? (
          <a
            href={href('full')}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-border-steel bg-paper px-5 py-2.5 text-sm font-semibold text-teal-deep transition-colors hover:border-teal hover:bg-teal-pale"
          >
            {copy('Apresentação completa', 'Full presentation')}
          </a>
        ) : null}
      </div>
      <div
        className="inline-flex items-center gap-1 rounded-md border border-border-steel bg-paper p-0.5"
        role="group"
        aria-label={copy('Idioma do documento do cliente', 'Client document language')}
      >
        {(['PT', 'EN'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={clientLanguage === option}
            onClick={() => setClientLanguage(option)}
            className={`min-h-8 rounded px-3 py-1 text-xs font-semibold transition-colors ${
              clientLanguage === option
                ? 'bg-teal text-paper'
                : 'text-ink-muted hover:bg-teal-pale hover:text-teal-deep'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}
