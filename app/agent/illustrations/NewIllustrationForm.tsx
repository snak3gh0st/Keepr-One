'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { Field, Input, Select } from '@/components/Field'
import { FORESIGHT_ISSUE_STATES } from '@/lib/national-life/foresight-illustration-contract'
import { requestForesightIllustration } from './new/actions'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'
import { ForesightActivityIndicator } from './ForesightActivityIndicator'
import { useI18n } from '@/components/i18n/LanguageProvider'

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
const TERM_DURATIONS = ['10-G', '15-G', '20-G', '30-G', 'ART'] as const
const IUL_STRATEGIES = {
  MAX_CASH_VALUE: { solveBasis: 'PREMIUM', solveMethod: 'Minimum_DB_Max_Cash_Value' },
  BALANCED_DB: { solveBasis: 'PREMIUM', solveMethod: 'Balanced_DB' },
  TARGET_PREMIUM: { solveBasis: 'PREMIUM', solveMethod: 'Based_on_Target_Premium' },
  PROTECTION_FOCUS: { solveBasis: 'DEATH_BENEFIT', solveMethod: 'Protection_Focus' },
  RETIREMENT_FOCUS: { solveBasis: 'DEATH_BENEFIT', solveMethod: 'Retirement_Focus' },
} as const

type IulStrategy = keyof typeof IUL_STRATEGIES

export function NewIllustrationForm({ extensionId }: { extensionId?: string }) {
  const { copy } = useI18n()
  const router = useRouter()
  const submitLock = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [productFamily, setProductFamily] = useState<'IUL' | 'TERM'>('IUL')
  const [termCarrier, setTermCarrier] = useState<'LSW_TERM' | 'NL_TERM'>('LSW_TERM')
  const [iulStrategy, setIulStrategy] = useState<IulStrategy>('MAX_CASH_VALUE')
  const selectedIulStrategy = IUL_STRATEGIES[iulStrategy]

  async function handleSubmit(formData: FormData) {
    // React state is not synchronous: two clicks in the same frame can both
    // enter before the disabled button is painted. The ref closes that gap.
    if (submitLock.current) return
    submitLock.current = true
    setSubmitting(true)
    setSubmitError(null)
    const result = await requestForesightIllustration(formData)
    if (!result.ok) {
      setSubmitError(result.message)
      setSubmitting(false)
      submitLock.current = false
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
        {copy('Ilustração oficial', 'Official illustration')}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
        {copy('Você revisa o cenário aqui. O K-Bot executa os passos aprovados no Foresight, confere o que a National Life calculou e traz apenas o PDF oficial válido.', 'Review the scenario here. K-Bot runs the approved steps in Foresight, checks what National Life calculated, and brings back only the valid official PDF.')}
      </p>

      <ol className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-border-steel bg-border-steel sm:grid-cols-3" aria-label={copy('Etapas da ilustração oficial', 'Official illustration steps')}>
        {[
          ['01', copy('Escolher produto', 'Choose product'), copy('IUL ou Term, cada um com sua própria rota', 'IUL or Term, each with its own path')],
          ['02', copy('Revisar cenário', 'Review scenario'), copy('Você define os dados materiais', 'You define the material data')],
          ['03', copy('Receber o PDF', 'Receive the PDF'), copy('Arquivo oficial verificado', 'Verified official file')],
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
            {copy('Produto', 'Product')}
            <span className="font-normal text-ink-muted">{copy('Escolha somente uma modalidade com contrato validado', 'Choose only one product with a validated contract')}</span>
          </legend>
          <input type="hidden" name="product" value={productFamily === 'IUL' ? 'FLEXLIFE_IUL' : termCarrier} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className={`relative flex min-h-28 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border p-4 transition-colors ${productFamily === 'IUL' ? 'border-teal bg-teal-pale/60' : 'border-border-steel bg-paper hover:bg-panel/55'}`}>
              <input
                className="sr-only"
                type="radio"
                name="productFamily"
                aria-label="IUL"
                checked={productFamily === 'IUL'}
                onChange={() => setProductFamily('IUL')}
              />
              <span>
                <strong className="block text-base font-semibold tracking-[-0.025em] text-ink">IUL</strong>
                <span className="mt-1 block text-xs leading-5 text-ink-muted">FlexLife • Indexed Universal Life</span>
              </span>
              <span className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-teal-deep">{copy('Pronto para gerar', 'Ready to generate')}</span>
            </label>
            <label className={`relative flex min-h-28 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border p-4 transition-colors ${productFamily === 'TERM' ? 'border-teal bg-teal-pale/60' : 'border-border-steel bg-paper hover:bg-panel/55'}`}>
              <input
                className="sr-only"
                type="radio"
                name="productFamily"
                aria-label="Term Life"
                checked={productFamily === 'TERM'}
                onChange={() => setProductFamily('TERM')}
              />
              <span>
                <strong className="block text-base font-semibold tracking-[-0.025em] text-ink">Term Life</strong>
                <span className="mt-1 block text-xs leading-5 text-ink-muted">{copy('LSW Term ou NL Term • prazo definido', 'LSW Term or NL Term • fixed term')}</span>
              </span>
              <span className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-teal-deep">{copy('Pronto para gerar', 'Ready to generate')}</span>
            </label>
          </div>
          <p className="mt-3 text-xs leading-5 text-ink-muted">
            {copy('Cada rota usa seu próprio contrato no Foresight. A Keepr One não converte Term em IUL, nem infere uma emissora ou prazo.', 'Each path uses its own contract in Foresight. Keepr One does not convert Term into IUL or infer a carrier or term.')}
          </p>
        </fieldset>

        <fieldset className="border-t border-border-steel pt-6">
          <legend className="flex items-center gap-3 text-sm font-semibold text-ink">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[10px] font-mono tracking-[0.08em] text-paper">02</span>
            {copy('Segurado', 'Insured')}
            <span className="font-normal text-ink-muted">{copy('Informação que será gravada no caso', 'Information that will be saved to the case')}</span>
          </legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={copy('Nome', 'First name')}><Input name="firstName" required placeholder="Maria" /></Field>
            <Field label={copy('Sobrenome', 'Last name')}><Input name="lastName" required placeholder="Silva" /></Field>
            <Field label={copy('Data de nascimento (DOB)', 'Date of birth (DOB)')}><Input name="dateOfBirth" type="date" required /></Field>
            <Field label={copy('Estado de emissão', 'Issue state')}>
              <Select name="issueState" required defaultValue="" className="w-full">
                <option value="" disabled>{copy('Selecione...', 'Select...')}</option>
                {FORESIGHT_ISSUE_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
              </Select>
            </Field>
            <Field label={copy('Sexo', 'Gender')}>
              <Select name="gender" required defaultValue="" className="w-full">
                <option value="" disabled>{copy('Selecione...', 'Select...')}</option>
                <option value={GENDERS.FEMALE}>{copy('Feminino', 'Female')}</option>
                <option value={GENDERS.MALE}>{copy('Masculino', 'Male')}</option>
              </Select>
            </Field>
            <Field label={copy('Classe de risco', 'Rate class')}>
              <Select name="rateClass" required defaultValue="" className="w-full">
                <option value="" disabled>{copy('Selecione...', 'Select...')}</option>
                <option value={RATE_CLASSES.STANDARD_NON_TOBACCO}>{copy('Standard não tabagista', 'Standard non-tobacco')}</option>
                <option value={RATE_CLASSES.STANDARD_TOBACCO}>{copy('Standard tabagista', 'Standard tobacco')}</option>
              </Select>
            </Field>
          </div>
        </fieldset>

        {productFamily === 'TERM' && <fieldset className="border-t border-border-steel pt-6">
          <legend className="flex items-center gap-3 text-sm font-semibold text-ink">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-teal text-[10px] font-mono tracking-[0.08em] text-paper">03</span>
            {copy('Cenário Term', 'Term scenario')}
            <span className="font-normal text-ink-muted">{copy('A National Life calcula o prêmio oficial por prazo', 'National Life calculates the official premium for each term')}</span>
          </legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={copy('Emissora do Term', 'Term carrier')}>
              <Select
                name="termCarrier"
                required
                value={termCarrier}
                onChange={(event) => setTermCarrier(event.target.value as 'LSW_TERM' | 'NL_TERM')}
                className="w-full"
              >
                <option value="LSW_TERM">LSW Term — Life Insurance Company of the Southwest</option>
                <option value="NL_TERM">NL Term — National Life Insurance Company</option>
              </Select>
            </Field>
            <Field label={copy('Prazo do Term', 'Term duration')}>
              <Select name="termDuration" required defaultValue="" className="w-full">
                <option value="" disabled>{copy('Selecione o prazo...', 'Select a term...')}</option>
                {TERM_DURATIONS.map((duration) => <option key={duration} value={duration}>{duration}</option>)}
              </Select>
            </Field>
            <Field label={copy('Capital segurado', 'Face amount')}><Input name="faceAmount" type="number" min={1} step="0.01" required placeholder="250000" /></Field>
          </div>
          <input type="hidden" name="premiumMode" value="Monthly" />
          <aside className="mt-5 rounded-xl border border-border-steel bg-panel/50 p-4" aria-label={copy('Cálculo de prêmio do Term', 'Term premium calculation')}>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-deep">{copy('Prêmio calculado pela seguradora', 'Premium calculated by the carrier')}</p>
            <p className="mt-2 text-xs leading-5 text-ink-muted">
              {copy('O Foresight recebe a emissora, prazo, capital e perfil de risco; ele calcula e apresenta os prêmios mensais reais no PDF oficial. A Keepr One não inventa nem sobrescreve esse valor.', 'Foresight receives the carrier, term, face amount, and risk profile; it calculates and presents the actual monthly premiums in the official PDF. Keepr One does not invent or overwrite this amount.')}
            </p>
          </aside>
        </fieldset>}

        {productFamily === 'IUL' && <fieldset className="border-t border-border-steel pt-6">
          <legend className="flex items-center gap-3 text-sm font-semibold text-ink">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-teal text-[10px] font-mono tracking-[0.08em] text-paper">03</span>
            {copy('Estratégia IUL • FlexLife', 'IUL strategy • FlexLife')}
            <span className="font-normal text-ink-muted">{copy('Escolha o objetivo do cliente no Foresight', "Choose the client's objective in Foresight")}</span>
          </legend>
          <input type="hidden" name="solveBasis" value={selectedIulStrategy.solveBasis} />
          <input type="hidden" name="solveMethod" value={selectedIulStrategy.solveMethod} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label={copy('Objetivo estratégico do IUL', 'IUL strategic objective')}>
            {([
              ['MAX_CASH_VALUE', copy('Máximo Cash Value', 'Maximum Cash Value'), copy('Menor benefício compatível com o aporte para priorizar valor acumulado.', 'Minimum compatible benefit for the contribution to prioritize accumulated value.')],
              ['BALANCED_DB', copy('Benefício balanceado', 'Balanced death benefit'), copy('Equilibra proteção e potencial de acumulação.', 'Balances protection and accumulation potential.')],
              ['TARGET_PREMIUM', 'Target Premium', copy('Usa o aporte informado como prêmio-alvo da ilustração.', 'Uses the entered contribution as the illustration target premium.')],
              ['PROTECTION_FOCUS', copy('Foco em proteção', 'Protection focus'), copy('Parte do capital segurado e calcula o prêmio necessário.', 'Starts from the face amount and calculates the required premium.')],
              ['RETIREMENT_FOCUS', copy('Foco em aposentadoria', 'Retirement focus'), copy('Configuração da National orientada a renda futura.', 'National Life configuration oriented toward future income.')],
            ] as const).map(([value, title, detail]) => (
              <label key={value} className={`relative flex cursor-pointer flex-col rounded-2xl border p-4 transition-colors ${iulStrategy === value ? 'border-teal bg-teal-pale/60' : 'border-border-steel bg-paper hover:bg-panel/55'}`}>
                <input
                  className="sr-only"
                  type="radio"
                  name="iulStrategyChoice"
                  aria-label={title}
                  checked={iulStrategy === value}
                  onChange={() => setIulStrategy(value)}
                />
                <strong className="text-sm font-semibold text-ink">{title}</strong>
                <span className="mt-1 text-xs leading-5 text-ink-muted">{detail}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {selectedIulStrategy.solveBasis === 'DEATH_BENEFIT'
              ? <Field label={copy('Capital segurado', 'Face amount')}><Input name="faceAmount" type="number" min={1} step="0.01" required placeholder="250000" /></Field>
              : <Field label={copy('Aporte mensal', 'Monthly contribution')}><Input name="monthlyPremium" type="number" min={0.01} step="0.01" required placeholder="350" /></Field>}
            <Field label={copy('Opção de benefício por morte', 'Death benefit option')}>
              <Select name="deathBenefitOption" required defaultValue="" className="w-full">
                <option value="" disabled>{copy('Selecione...', 'Select...')}</option>
                <option value={DEATH_BENEFIT_OPTIONS.LEVEL}>{copy('A — nivelado', 'A — level')}</option>
                <option value={DEATH_BENEFIT_OPTIONS.INCREASING}>{copy('B — crescente', 'B — increasing')}</option>
              </Select>
            </Field>
            <Field label={copy('Estratégia de índice', 'Index strategy')}>
              <Select name="strategy" required defaultValue={CAP_FOCUS} className="w-full">
                <option value={CAP_FOCUS}>{copy('S&P 500 — foco em teto', 'S&P 500 — cap focus')}</option>
              </Select>
            </Field>
          </div>
          <aside className="mt-5 rounded-xl border border-border-steel bg-panel/50 p-4" aria-label={copy('Configuração padrão do Foresight', 'Default Foresight settings')}>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-deep">{copy('Configuração padrão do Foresight', 'Default Foresight settings')}</p>
            <div className="mt-3 grid gap-2 text-xs leading-5 text-ink-muted sm:grid-cols-2">
              <p><strong className="font-semibold text-ink">{copy('Ilustração:', 'Illustration:')}</strong> Basic Illustration, GPT {copy('e', 'and')} MEC “None”.</p>
              <p><strong className="font-semibold text-ink">{copy('Objetivo escolhido:', 'Selected objective:')}</strong> {copy('o K-Bot usa a estratégia correspondente da própria National Life e confirma a seleção por leitura de volta.', 'K-Bot uses the corresponding National Life strategy and confirms the selection by reading it back.')}</p>
              <p><strong className="font-semibold text-ink">{copy('Validação:', 'Validation:')}</strong> {copy('a Keepr One só aceita o PDF se os dois valores calculados e o método escolhido voltarem do Foresight.', 'Keepr One accepts the PDF only if both calculated values and the selected method return from Foresight.')}</p>
              <p><strong className="font-semibold text-ink">{copy('Exchange e distribuição:', 'Exchange and distribution:')}</strong> {copy('ambos “None”.', 'both “None”.')}</p>
            </div>
          </aside>
        </fieldset>}

        <div className="flex flex-col gap-4 border-t border-border-steel pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-xs leading-5 text-ink-muted">
            {copy('Você pode sair desta tela. O K-Bot continua em segundo plano e só pede sua atenção se a National Life solicitar login. Se o portal alterar um valor, a geração para antes do PDF.', 'You can leave this screen. K-Bot continues in the background and asks for your attention only if National Life requires login. If the portal changes a value, generation stops before the PDF.')}
          </p>
          <Button type="submit" variant="primary" disabled={submitting} className="w-full shrink-0 sm:w-auto">
            {submitting
              ? <ForesightActivityIndicator label={copy('K-Bot está preparando o cenário…', 'K-Bot is preparing the scenario…')} />
              : copy('Gerar ilustração oficial', 'Generate official illustration')}
          </Button>
        </div>
      </form>

      {submitError && <p role="alert" className="mt-4 text-sm text-danger">{submitError}</p>}
    </div>
  )
}
