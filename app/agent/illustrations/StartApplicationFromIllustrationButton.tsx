'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { startApplicationFromIllustration } from '@/app/agent/cases/[id]/actions'

export function StartApplicationFromIllustrationButton({
  illustrationId,
  compact = false,
}: {
  illustrationId: string
  compact?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function startApplication() {
    setMessage(null)
    startTransition(async () => {
      const result = await startApplicationFromIllustration(illustrationId)
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      router.push(`/agent/cases/${result.caseId}#application`)
    })
  }

  return (
    <div className={compact ? 'min-w-40' : ''}>
      <Button
        type="button"
        variant="primary"
        disabled={pending}
        onClick={startApplication}
        className={compact ? 'w-full' : ''}
      >
        {pending ? 'Criando Application…' : 'Criar Application no iGO'}
      </Button>
      {message ? <p role="alert" className="mt-2 max-w-xs text-xs leading-5 text-danger">{message}</p> : null}
    </div>
  )
}
