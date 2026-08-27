'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { Field, Input, Select } from '@/components/Field'
import { FORESIGHT_ISSUE_STATES } from '@/lib/national-life/foresight-illustration-contract'
import { FORESIGHT_ILLUSTRATION_PRODUCTS } from '@/lib/national-life/foresight-product-catalog'
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
        National Life • Foresight
      </p>
      <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
        Ilustração oficial
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
        Você revisa o cenário aqui. O KeeproneConnect o preenche em uma aba discreta do
        Foresight, confere o que a National Life reteve e traz apenas o PDF oficial válido.
      </p>

      <ol className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-border-steel bg-border-steel sm:grid-cols-3" aria-label="Etapas da ilustração oficial">
        {[
          ['01', 'Escolher produto', 'IUL pronto para gerar'],
          ['02', 'Revisar cenário', 'Você define os dados materiais'],
          ['03', 'Receber o PDF', 'Arquivo oficial verificado'],
        ].map(([number, title, detail], index) => (
          <li key={number} className={`flex gap-3 bg-paper px-4 py-3.5 ${index === 0 ? 'bg-teal-pale/45' : ''}`}>
            <span className={`font-mono text-[10px] font-semibold tracking-[0.12em] ${index === 0 ? 'text-teal-deep' : 'text-ink-muted'}`}>{number}</span>
            <span className="min-w-0">
              <strong className="block text-xs font-semibold text-ink">{title}</strong>
              <small className="mt-0.5 block text-[11px] leading-4 text-ink-muted">{detail}</small>
            </span>
          </li>
        ))}
      </ol>

      <form action={handleSubmit} className="mt-6 space-y-6">
        <fieldset>
          <legend className="flex items-center gap-3 text-sm font-semibold text-ink">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[10px] font-mono tracking-[0.08em] text-paper">01</span>
            Produto
            <span className="font-normal text-ink-muted">Escolha somente uma modalidade com contrato validado</span>
          </legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {FORESIGHT_ILLUSTRATION_PRODUCTS.map((product) => {
              const ready = product.availability === 'READY'
              return (
                <label
                  key={product.key}
                  className={`group relative flex min-h-28 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border p-4 transition-colors ${
                    ready
                      ? 'border-teal bg-teal-pale/35 hover:bg-teal-pale/60'
                      : 'cursor-not-allowed border-border-steel bg-panel/55 opacity-65'
                  }`}
                >
                  <input
                    className="sr-only"
                    type="radio"
                    name="product"
                    value={product.key}
                    defaultChecked={ready}
                    disabled={!ready}
                  />
                  <span>
                    <strong className="block text-base font-semibold tracking-[-0.025em] text-ink">{product.label}</strong>
                    <span className="mt-1 block text-xs leading-5 text-ink-muted">{product.description}</span>
                  </span>
                  <span className={`mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${ready ? 'text-teal-deep' : 'text-ink-muted'}`}>
                    {ready ? 'Pronto para gerar' : 'Contrato do Foresight pendente'}
                  </span>
                </label>
              )
            })}
          </div>
          <p className="mt-3 text-xs leading-5 text-ink-muted">
            Term aparece no seletor oficial da National Life, mas só será liberado aqui depois que a rota e os campos próprios forem validados — nunca como uma ilustração IUL disfarçada.
          </p>
        </fieldset>

        <fieldset className="border-t border-border-steel pt-6">
          <legend className="flex items-center gap-3 text-sm font-semibold text-ink">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[10px] font-mono tracking-[0.08em] text-paper">02</span>
            Segurado
            <span className="font-normal text-ink-muted">Informação que será gravada no caso</span>
          </legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Nome"><Input name="firstName" required placeholder="Maria" /></Field>
            <Field label="Sobrenome"><Input name="lastName" required placeholder="Silva" /></Field>
            <Field label="Data de nascimento (DOB)"><Input name="dateOfBirth" type="date" required /></Field>
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
          </div>
        </fieldset>

        <fieldset className="border-t border-border-steel pt-6">
          <legend className="flex items-center gap-3 text-sm font-semibold text-ink">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-teal text-[10px] font-mono tracking-[0.08em] text-paper">03</span>
            Cenário IUL • FlexLife
            <span className="font-normal text-ink-muted">Os valores que você quer ilustrar</span>
          </legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Capital segurado"><Input name="faceAmount" type="number" min={1} step="0.01" required placeholder="250000" /></Field>
            <Field label="Prêmio mensal"><Input name="monthlyPremium" type="number" min={0.01} step="0.01" required placeholder="350" /></Field>
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
          </div>
          <aside className="mt-5 rounded-xl border border-border-steel bg-panel/50 p-4" aria-label="Configuração padrão do Foresight">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-deep">Configuração padrão do Foresight</p>
            <div className="mt-3 grid gap-2 text-xs leading-5 text-ink-muted sm:grid-cols-2">
              <p><strong className="font-semibold text-ink">Ilustração:</strong> Basic Illustration, solve “None”, GPT e MEC “None”.</p>
              <p><strong className="font-semibold text-ink">Benefício:</strong> uma linha de capital e vigência 1–M; APB em US$ 0.</p>
              <p><strong className="font-semibold text-ink">Prêmio:</strong> mensal, “Specify Amount”, sem ajuste, vigência 1–M.</p>
              <p><strong className="font-semibold text-ink">Exchange e distribuição:</strong> ambos “None”.</p>
            </div>
          </aside>
        </fieldset>

        <div className="flex flex-col gap-4 border-t border-border-steel pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-xs leading-5 text-ink-muted">
            Você pode sair desta tela. A extensão abre o Foresight em segundo plano; só traz a aba à frente se a National Life pedir login. Se o portal alterar um valor, a geração para antes do PDF.
          </p>
          <Button type="submit" variant="primary" disabled={submitting} className="w-full shrink-0 sm:w-auto">
            {submitting ? 'Preparando no Foresight...' : 'Gerar ilustração oficial'}
          </Button>
        </div>
      </form>

      {submitError && <p role="alert" className="mt-4 text-sm text-danger">{submitError}</p>}
    </div>
  )
}
