'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/Button'
import { Field, Input, Select } from '@/components/Field'
import { useI18n } from '@/components/i18n/LanguageProvider'
import {
  DEFAULT_MODULES_BY_PLAN,
  PLATFORM_MODULE_CATALOG,
  PLATFORM_MODULES,
  type PlatformModuleName,
} from '@/lib/platform-modules'
import { formatPlatformPlanPrice } from '@/lib/plans'
import {
  createManagedUserAction,
  type CreateManagedUserState,
} from '../create-actions'

const INITIAL_STATE: CreateManagedUserState = { status: 'idle', message: '' }
type AccountType = 'AGENT_INDIVIDUAL' | 'AGENCY'
type AccessMode = 'TRIAL' | 'PAYMENT_REQUIRED'

function SubmitButton() {
  const { copy } = useI18n()
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="primary"
      disabled={pending}
      aria-busy={pending}
      className="w-full"
    >
      {pending ? copy('Criando acesso…', 'Creating access…') : copy('Criar usuário', 'Create user')}
    </Button>
  )
}

function FormFeedback({ state }: { state: CreateManagedUserState }) {
  if (state.status !== 'error' || !state.message) return null
  return (
    <p
      role="alert"
      aria-live="polite"
      className="rounded-lg bg-danger-pale px-3.5 py-3 text-sm text-danger"
    >
      {state.message}
    </p>
  )
}

function SectionHeading({
  id,
  step,
  title,
  description,
}: {
  id: string
  step: string
  title: string
  description: string
}) {
  return (
    <div className="border-b border-border-steel pb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.03em] text-teal">
        {step}
      </p>
      <h2 id={id} className="mt-2 text-lg font-semibold tracking-[-0.03em] text-ink">{title}</h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-muted">{description}</p>
    </div>
  )
}

export function CreateManagedUserForm() {
  const { copy, language, locale } = useI18n()
  const [state, action] = useActionState(createManagedUserAction, INITIAL_STATE)
  const [accountType, setAccountType] = useState<AccountType>('AGENT_INDIVIDUAL')
  const [accessMode, setAccessMode] = useState<AccessMode>('TRIAL')
  const [trialDays, setTrialDays] = useState('30')
  const [sendAccessEmail, setSendAccessEmail] = useState(true)
  const [selectedModules, setSelectedModules] = useState<Set<PlatformModuleName>>(
    () => new Set(DEFAULT_MODULES_BY_PLAN.AGENT_INDIVIDUAL),
  )

  const availableModules = PLATFORM_MODULES.filter(
    (module) => accountType === 'AGENCY' || (module !== 'AGENCY' && module !== 'TEAM'),
  )
  const selectedModuleCount = availableModules.filter((module) => selectedModules.has(module)).length
  const selectedPlanLabel = accountType === 'AGENCY'
    ? copy('Plano Agência', 'Agency plan')
    : copy('Plano Agente', 'Agent plan')
  const selectedAccessLabel = accessMode === 'TRIAL'
    ? copy(`${trialDays || '—'} dias de teste`, `${trialDays || '—'}-day trial`)
    : copy('Pagamento obrigatório', 'Payment required')

  function changeAccountType(nextType: AccountType) {
    setAccountType(nextType)
    setSelectedModules(new Set(DEFAULT_MODULES_BY_PLAN[nextType]))
  }

  function toggleModule(module: PlatformModuleName) {
    if (module === 'TODAY') return
    setSelectedModules((current) => {
      const next = new Set(current)
      if (next.has(module)) next.delete(module)
      else next.add(module)
      return next
    })
  }

  return (
    <form action={action} className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <section className="rounded-xl border border-border-steel bg-paper p-5 sm:p-6" aria-labelledby="new-user-profile-heading">
          <SectionHeading
            id="new-user-profile-heading"
            step={copy('01 · Identidade', '01 · Identity')}
            title={copy('Dados de acesso', 'Access details')}
            description={copy(
              'Informe os dados que identificam o usuário no painel e nos contatos da operação.',
              'Enter the details that identify this user in the dashboard and operational contacts.',
            )}
          />

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Field
              label={copy('Nome completo', 'Full name')}
              htmlFor="new-user-name"
              required
              error={state.fieldErrors?.name}
            >
              <Input
                id="new-user-name"
                name="name"
                required
                minLength={2}
                maxLength={100}
                autoComplete="name"
                aria-invalid={Boolean(state.fieldErrors?.name)}
              />
            </Field>
            <Field
              label={copy('E-mail', 'Email')}
              htmlFor="new-user-email"
              required
              error={state.fieldErrors?.email}
            >
              <Input
                id="new-user-email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                aria-invalid={Boolean(state.fieldErrors?.email)}
              />
            </Field>
            <Field
              label={copy('Telefone', 'Phone')}
              htmlFor="new-user-phone"
              required
              error={state.fieldErrors?.phone}
            >
              <Input
                id="new-user-phone"
                name="phone"
                type="tel"
                required
                maxLength={32}
                autoComplete="tel"
                placeholder="+1 305 555 0100"
                aria-invalid={Boolean(state.fieldErrors?.phone)}
              />
            </Field>
            <Field
              label={copy('NPN', 'NPN')}
              htmlFor="new-user-npn"
              hint={copy('Opcional.', 'Optional.')}
              error={state.fieldErrors?.npn}
            >
              <Input
                id="new-user-npn"
                name="npn"
                inputMode="numeric"
                maxLength={40}
                autoComplete="off"
                className="font-mono tabular-nums"
                aria-invalid={Boolean(state.fieldErrors?.npn)}
              />
            </Field>
            <Field
              label={copy('Idioma do painel', 'Dashboard language')}
              htmlFor="new-user-language"
              required
              error={state.fieldErrors?.language}
            >
              <Select id="new-user-language" name="language" defaultValue={language} required>
                <option value="PT">Português</option>
                <option value="EN">English</option>
              </Select>
            </Field>
            <Field
              label={copy('Fuso horário', 'Time zone')}
              htmlFor="new-user-time-zone"
              required
              error={state.fieldErrors?.timeZone}
            >
              <Select id="new-user-time-zone" name="timeZone" defaultValue="America/New_York" required>
                <option value="America/New_York">Eastern Time (New York)</option>
                <option value="America/Chicago">Central Time (Chicago)</option>
                <option value="America/Denver">Mountain Time (Denver)</option>
                <option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>
                <option value="America/Sao_Paulo">Horário de Brasília (São Paulo)</option>
                <option value="UTC">UTC</option>
              </Select>
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-border-steel bg-paper p-5 sm:p-6" aria-labelledby="new-user-plan-heading">
          <SectionHeading
            id="new-user-plan-heading"
            step={copy('02 · Plano e acesso', '02 · Plan and access')}
            title={copy('Como a conta começa', 'How the account starts')}
            description={copy(
              'Escolha o plano comercial e libere um teste ou cobre a assinatura antes do primeiro acesso.',
              'Choose the commercial plan and either grant a trial or require payment before first access.',
            )}
          />

          <fieldset className="mt-6">
            <legend className="text-xs font-semibold uppercase tracking-[0.03em] text-ink-muted">
              {copy('Plano', 'Plan')} <span aria-hidden className="text-danger">*</span>
            </legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(['AGENT_INDIVIDUAL', 'AGENCY'] as const).map((plan) => {
                const checked = accountType === plan
                const agency = plan === 'AGENCY'
                return (
                  <label
                    key={plan}
                    className={`cursor-pointer rounded-xl border p-4 transition-[border-color,background-color,box-shadow] ${
                      checked
                        ? 'border-teal bg-teal-pale/45'
                        : 'border-border-steel bg-paper hover:border-ink-muted'
                    }`}
                  >
                    <span className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="accountType"
                        value={plan}
                        checked={checked}
                        onChange={() => changeAccountType(plan)}
                        className="mt-1 h-4 w-4 shrink-0 accent-teal"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">
                          {agency ? copy('Plano Agência', 'Agency plan') : copy('Plano Agente', 'Agent plan')}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-ink-muted">
                          {agency
                            ? copy('Responsável e estrutura própria de equipe.', 'Owner with their own team structure.')
                            : copy('Acesso pessoal sem gestão de equipe.', 'Personal access without team management.')}
                        </span>
                        <span className="mt-3 block font-mono text-xs font-semibold text-ink">
                          {formatPlatformPlanPrice(plan, locale)} {copy('/mês', '/month')}
                        </span>
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
            {state.fieldErrors?.accountType ? (
              <p className="mt-2 text-xs text-danger" role="alert">{state.fieldErrors.accountType}</p>
            ) : null}
          </fieldset>

          {accountType === 'AGENCY' ? (
            <div className="mt-5">
              <Field
                label={copy('Nome da agência', 'Agency name')}
                htmlFor="new-user-agency-name"
                required
                error={state.fieldErrors?.agencyName}
              >
                <Input
                  id="new-user-agency-name"
                  name="agencyName"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="organization"
                  aria-invalid={Boolean(state.fieldErrors?.agencyName)}
                />
              </Field>
            </div>
          ) : null}

          <fieldset className="mt-6 border-t border-border-steel pt-6">
            <legend className="text-xs font-semibold uppercase tracking-[0.03em] text-ink-muted">
              {copy('Acesso inicial', 'Initial access')} <span aria-hidden className="text-danger">*</span>
            </legend>
            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-steel px-4 py-3.5 hover:border-ink-muted">
                <input
                  type="radio"
                  name="accessMode"
                  value="TRIAL"
                  checked={accessMode === 'TRIAL'}
                  onChange={() => setAccessMode('TRIAL')}
                  className="mt-1 h-4 w-4 shrink-0 accent-teal"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">{copy('Liberar teste', 'Grant trial')}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
                    {copy('O usuário entra agora e será bloqueado quando o período terminar.', 'The user gets access now and is blocked when the period ends.')}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-steel px-4 py-3.5 hover:border-ink-muted">
                <input
                  type="radio"
                  name="accessMode"
                  value="PAYMENT_REQUIRED"
                  checked={accessMode === 'PAYMENT_REQUIRED'}
                  onChange={() => setAccessMode('PAYMENT_REQUIRED')}
                  className="mt-1 h-4 w-4 shrink-0 accent-teal"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">{copy('Exigir pagamento', 'Require payment')}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
                    {copy('O painel abre no pagamento e só é liberado após a assinatura.', 'The dashboard opens at payment and unlocks only after subscription.')}
                  </span>
                </span>
              </label>
            </div>
            {state.fieldErrors?.accessMode ? (
              <p className="mt-2 text-xs text-danger" role="alert">{state.fieldErrors.accessMode}</p>
            ) : null}
          </fieldset>

          {accessMode === 'TRIAL' ? (
            <div className="mt-5 max-w-xs">
              <Field
                label={copy('Dias de teste', 'Trial days')}
                htmlFor="new-user-trial-days"
                required
                hint={copy('Entre 1 e 365 dias.', 'Between 1 and 365 days.')}
                error={state.fieldErrors?.trialDays}
              >
                <Input
                  id="new-user-trial-days"
                  name="trialDays"
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  required
                  value={trialDays}
                  onChange={(event) => setTrialDays(event.target.value)}
                  className="font-mono tabular-nums"
                  aria-invalid={Boolean(state.fieldErrors?.trialDays)}
                />
              </Field>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-border-steel bg-paper p-5 sm:p-6" aria-labelledby="new-user-modules-heading">
          <SectionHeading
            id="new-user-modules-heading"
            step={copy('03 · Módulos', '03 · Modules')}
            title={copy('O que fica disponível', 'What is available')}
            description={copy(
              'Libere apenas o necessário. O módulo Hoje é a base do painel e permanece ativo.',
              'Release only what is needed. Today is the dashboard baseline and always stays enabled.',
            )}
          />

          <fieldset className="mt-2">
            <legend className="sr-only">{copy('Módulos liberados', 'Enabled modules')}</legend>
            <input type="hidden" name="modules" value="TODAY" />
            <div className="grid sm:grid-cols-2 sm:gap-x-6">
              {availableModules.map((module) => {
                const item = PLATFORM_MODULE_CATALOG[module]
                const required = module === 'TODAY'
                return (
                  <label
                    key={module}
                    className={`flex min-h-[76px] items-start gap-3 border-b border-border-steel py-4 ${
                      required ? 'cursor-default' : 'cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      name={required ? undefined : 'modules'}
                      value={module}
                      checked={selectedModules.has(module)}
                      disabled={required}
                      onChange={() => toggleModule(module)}
                      className="mt-1 h-4 w-4 shrink-0 accent-teal"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                        {item.label[language]}
                        {required ? (
                          <span className="rounded-full bg-teal-pale px-2 py-0.5 text-xs font-semibold tracking-[0.03em] text-teal">
                            {copy('Obrigatório', 'Required')}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-ink-muted">
                        {item.description[language]}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
            {state.fieldErrors?.modules ? (
              <p className="mt-3 text-xs text-danger" role="alert">{state.fieldErrors.modules}</p>
            ) : null}
          </fieldset>
        </section>

        <section className="rounded-xl border border-border-steel bg-paper p-5 sm:p-6" aria-labelledby="new-user-delivery-heading">
          <SectionHeading
            id="new-user-delivery-heading"
            step={copy('04 · Primeiro acesso', '04 · First access')}
            title={copy('Entregar o acesso', 'Deliver access')}
            description={copy(
              'A senha temporária nunca é exibida. O usuário define a própria senha por um link seguro.',
              'The temporary password is never shown. The user sets their own password through a secure link.',
            )}
          />
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-border-steel bg-panel/45 px-4 py-3.5">
            <input
              type="checkbox"
              name="sendAccessEmail"
              value="yes"
              checked={sendAccessEmail}
              onChange={(event) => setSendAccessEmail(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-teal"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">{copy('Enviar e-mail para definir senha', 'Send password setup email')}</span>
              <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
                {copy('Recomendado. O envio acontece logo após a criação da conta.', 'Recommended. It is sent immediately after account creation.')}
              </span>
            </span>
          </label>
        </section>
      </div>

      <aside className="rounded-xl border border-border-steel bg-paper p-5 xl:sticky xl:top-6" aria-label={copy('Resumo do novo acesso', 'New access summary')}>
        <p className="text-xs font-semibold uppercase tracking-[0.03em] text-teal">
          {copy('Resumo', 'Summary')}
        </p>
        <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-ink">
          {copy('Novo usuário', 'New user')}
        </h2>
        <dl className="mt-5 divide-y divide-border-steel border-y border-border-steel">
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="text-xs text-ink-muted">{copy('Plano', 'Plan')}</dt>
            <dd className="text-right text-sm font-semibold text-ink">{selectedPlanLabel}</dd>
          </div>
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="text-xs text-ink-muted">{copy('Mensalidade', 'Monthly price')}</dt>
            <dd className="text-right font-mono text-xs font-semibold text-ink">
              {formatPlatformPlanPrice(accountType, locale)}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="text-xs text-ink-muted">{copy('Início', 'Starts with')}</dt>
            <dd className="text-right text-sm font-medium text-ink">{selectedAccessLabel}</dd>
          </div>
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="text-xs text-ink-muted">{copy('Módulos', 'Modules')}</dt>
            <dd className="text-right text-sm font-medium text-ink">
              {selectedModuleCount} {copy('liberados', 'enabled')}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="text-xs text-ink-muted">{copy('Primeiro acesso', 'First access')}</dt>
            <dd className="max-w-[150px] text-right text-sm font-medium text-ink">
              {sendAccessEmail ? copy('E-mail automático', 'Automatic email') : copy('Envio manual', 'Manual delivery')}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs leading-5 text-ink-muted">
          {accessMode === 'TRIAL'
            ? copy('O bloqueio de pagamento será aplicado automaticamente ao fim do teste.', 'The payment gate is applied automatically when the trial ends.')
            : copy('O usuário verá a cobrança antes de acessar os módulos liberados.', 'The user will see payment before accessing enabled modules.')}
        </p>

        <div className="mt-5 space-y-3 border-t border-border-steel pt-5">
          <FormFeedback state={state} />
          <SubmitButton />
          <Link
            href="/admin/users"
            className="flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
          >
            {copy('Cancelar', 'Cancel')}
          </Link>
        </div>
      </aside>
    </form>
  )
}
