'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { Field, Input, Select } from '@/components/Field'
import { FORESIGHT_ISSUE_STATES } from '@/lib/national-life/foresight-illustration-contract'
import { requestForesightIllustration } from './new/actions'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'

const GENDERS = {
  FEMALE: 'Female',
  MALE: 'Male',
} as const

const RATE_CLASSES = {
  STANDARD_NON_TOBACCO: 'Standard_NT',
  STANDARD_TOBACCO: 'Standard_Tobacco',
} as const

const DEATH_BENEFIT_OPTIONS = {
  LEVEL: 'A_Level',
  INCREASING: 'B_Increasing',
} as const

const CAP_FOCUS = 'SP500PointToPointCapFocus'

export function NewIllustrationForm({ extensionId }: { extensionId?: string }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setSubmitting(true)
    setSubmitError(null)
    const result = await requestForesightIllustration(formData)
    if (!result.ok) {
      setSubmitError(result.message)
      setSubmitting(false)
      return
    }
    if (extensionId) {
      try {
        await sendConnectorMessage(extensionId, {
          type: 'START_NATIONAL_LIFE_COMMAND',
          commandId: result.commandId,
        })
      } catch {
        // The extension alarm picks up the durable, approved command if the
        // immediate page-to-extension wake-up is unavailable.
      }
    }
    router.push(`/agent/illustrations/${encodeURIComponent(result.illustrationId)}`)
  }

  return (
    <div className="module-main-surface">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
        National Life • Foresight • FlexLife
      </p>
      <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
        Ilustração oficial FlexLife
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
        O KeeproneConnect preenche e salva a ilustração no Foresight da National Life,
        confere os dados gravados e traz o PDF oficial para cá.
      </p>

      <form action={handleSubmit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Nome">
          <Input name="firstName" required placeholder="Maria" />
        </Field>
        <Field label="Sobrenome">
          <Input name="lastName" required placeholder="Silva" />
        </Field>
        <Field label="Data de nascimento (DOB)">
          <Input name="dateOfBirth" type="date" required />
        </Field>
        <Field label="Estado de emissão">
          <Select name="issueState" required defaultValue="" className="w-full">
            <option value="" disabled>Selecione...</option>
            {FORESIGHT_ISSUE_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
          </Select>
        </Field>
        <Field label="Sexo">
          <Select name="gender" required defaultValue="" className="w-full">
            <option value="" disabled>Selecione...</option>
            <option value={GENDERS.FEMALE}>Feminino</option>
            <option value={GENDERS.MALE}>Masculino</option>
          </Select>
        </Field>
        <Field label="Classe de risco">
          <Select name="rateClass" required defaultValue="" className="w-full">
            <option value="" disabled>Selecione...</option>
            <option value={RATE_CLASSES.STANDARD_NON_TOBACCO}>Standard não-tabagista</option>
            <option value={RATE_CLASSES.STANDARD_TOBACCO}>Standard tabagista</option>
          </Select>
        </Field>
        <Field label="Capital segurado">
          <Input name="faceAmount" type="number" min={1} step="0.01" required placeholder="250000" />
        </Field>
        <Field label="Prêmio mensal">
          <Input name="monthlyPremium" type="number" min={0.01} step="0.01" required placeholder="350" />
        </Field>
        <Field label="Opção de benefício por morte">
          <Select name="deathBenefitOption" required defaultValue="" className="w-full">
            <option value="" disabled>Selecione...</option>
            <option value={DEATH_BENEFIT_OPTIONS.LEVEL}>A — nivelado</option>
            <option value={DEATH_BENEFIT_OPTIONS.INCREASING}>B — crescente</option>
          </Select>
        </Field>
        <Field label="Estratégia de índice">
          <Select name="strategy" required defaultValue={CAP_FOCUS} className="w-full">
            <option value={CAP_FOCUS}>S&P 500 — foco em teto</option>
          </Select>
        </Field>

        <div className="border-t border-border-steel pt-5 sm:col-span-2">
          <Button type="submit" variant="primary" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? 'Iniciando...' : 'Gerar ilustração oficial'}
          </Button>
          <p className="mt-3 text-xs leading-5 text-ink-muted">
            Você pode sair desta tela. Se a sessão da National Life expirar, o KeeprOne pede o login e continua de onde parou.
          </p>
        </div>
      </form>

      {submitError && <p role="alert" className="mt-4 text-sm text-danger">{submitError}</p>}
    </div>
  )
}
