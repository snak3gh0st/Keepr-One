'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/Button'
import { Field, Input, Select } from '@/components/Field'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { RANKS } from '@/lib/ranks'
import {
  requestManagedUserPasswordResetAction,
  resendManagedUserVerificationAction,
  revokeManagedUserSessionsAction,
  updateManagedUserAccessAction,
  updateManagedUserProfileAction,
  type AdminUserActionState,
} from '../actions'
import {
  requestManagedUserEmailChangeAction,
  type EmailChangeRequestActionState,
} from '../email-change-actions'
import {
  startManagedUserImpersonationAction,
  type ImpersonationActionState,
} from '../impersonation-actions'

const INITIAL_ADMIN_USER_FORM_STATE: AdminUserActionState = {
  status: 'idle',
  message: '',
}

const INITIAL_EMAIL_CHANGE_FORM_STATE: EmailChangeRequestActionState = {
  status: 'idle',
  message: '',
}

const INITIAL_IMPERSONATION_FORM_STATE: ImpersonationActionState = {
  status: 'idle',
  message: '',
}

type ProfileValues = {
  id: string
  updatedAt: string
  agentUpdatedAt: string | null
  agencyUpdatedAt: string | null
  clientUpdatedAt: string | null
  name: string
  email: string
  language: 'PT' | 'EN'
  timeZone: string
  phone: string | null
  npn: string | null
  rank: string | null
  agencyName: string | null
  clientName: string | null
  clientEmail: string | null
  clientPhone: string | null
  isAgent: boolean
  isClient: boolean
  ownsAgency: boolean
}

function FormFeedback({ state }: { state: AdminUserActionState }) {
  if (state.status === 'idle' || !state.message) return null
  return (
    <p
      className={`rounded-lg px-3.5 py-3 text-sm ${
        state.status === 'success'
          ? 'bg-success-pale text-success'
          : 'bg-danger-pale text-danger'
      }`}
      role={state.status === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {state.message}
    </p>
  )
}

function SubmitButton({
  idle,
  pending,
  variant = 'secondary',
  className = '',
}: {
  idle: string
  pending: string
  variant?: 'primary' | 'secondary' | 'danger'
  className?: string
}) {
  const status = useFormStatus()
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={status.pending}
      aria-busy={status.pending}
      className={className}
    >
      {status.pending ? pending : idle}
    </Button>
  )
}

export function ManagedUserPreviewControl({
  userId,
  role,
  accessStatus,
  isCurrentUser,
  hasOperationalProfile,
  isAgency,
}: {
  userId: string
  role: 'ADMIN' | 'AGENT' | 'CLIENT'
  accessStatus: 'ACTIVE' | 'SUSPENDED'
  isCurrentUser: boolean
  hasOperationalProfile: boolean
  isAgency: boolean
}) {
  const { copy } = useI18n()
  const [state, action] = useActionState(
    startManagedUserImpersonationAction,
    INITIAL_IMPERSONATION_FORM_STATE,
  )

  const blockedReason = role === 'ADMIN'
    ? copy(
        'Contas da equipe Keepr One são protegidas contra esse tipo de acesso.',
        'Keepr One staff accounts are protected from this type of access.',
      )
    : isCurrentUser
      ? copy('Esta já é a sua conta atual.', 'This is already your current account.')
      : accessStatus === 'SUSPENDED'
        ? copy(
            'Restaure o acesso da conta para visualizar o painel.',
            'Restore account access to preview the dashboard.',
          )
        : !hasOperationalProfile
          ? copy(
              'O perfil operacional necessário ainda não foi criado ou está inativo.',
              'The required operational profile has not been created or is inactive.',
            )
          : null

  if (blockedReason) {
    return (
      <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-3 text-xs leading-5 text-white/60">
        {blockedReason}
      </p>
    )
  }

  const targetLabel = role === 'CLIENT'
    ? copy('portal do cliente', 'client portal')
    : isAgency
      ? copy('painel da agência', 'agency dashboard')
      : copy('painel do agente', 'agent dashboard')

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <label className="block">
        <span className="text-xs font-semibold text-white/85">
          {copy('Motivo do acesso', 'Reason for access')}
        </span>
        <textarea
          name="reason"
          required
          minLength={5}
          maxLength={240}
          rows={3}
          placeholder={copy('Ex.: validar configuração da agenda', 'E.g. verify calendar settings')}
          className="mt-2 w-full resize-y rounded-lg border border-white/15 bg-white/[0.06] px-3.5 py-3 text-sm text-white outline-none placeholder:text-white/35 focus-visible:border-[#8ef0b5] focus-visible:ring-[3px] focus-visible:ring-[#8ef0b5]/15"
        />
      </label>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-3.5 py-3">
        <input
          type="checkbox"
          name="confirmed"
          value="yes"
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#8ef0b5]"
        />
        <span className="text-xs leading-5 text-white/65">
          {copy(
            'Entendo que esta visualização é somente leitura, dura 15 minutos e afeta todas as abas deste navegador.',
            'I understand this is a read-only 15-minute preview that affects every tab in this browser.',
          )}
        </span>
      </label>
      {state.status === 'error' ? (
        <p className="rounded-lg bg-[#ff6b63]/15 px-3.5 py-3 text-xs text-[#ffaaa5]" role="alert">
          {state.message}
        </p>
      ) : null}
      <SubmitButton
        idle={copy(`Visualizar ${targetLabel}`, `Open ${targetLabel}`)}
        pending={copy('Abrindo visualização…', 'Opening preview…')}
        variant="primary"
        className="w-full bg-[#8ef0b5] text-[#07130d] hover:bg-white"
      />
    </form>
  )
}

export function ManagedUserProfileForm({ values }: { values: ProfileValues }) {
  const { copy } = useI18n()
  const [state, action] = useActionState(
    updateManagedUserProfileAction,
    INITIAL_ADMIN_USER_FORM_STATE,
  )
  const inputClass = 'w-full'

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="userId" value={values.id} />
      <input type="hidden" name="expectedUpdatedAt" value={values.updatedAt} />
      <input type="hidden" name="expectedAgentUpdatedAt" value={values.agentUpdatedAt ?? ''} />
      <input type="hidden" name="expectedAgencyUpdatedAt" value={values.agencyUpdatedAt ?? ''} />
      <input type="hidden" name="expectedClientUpdatedAt" value={values.clientUpdatedAt ?? ''} />

      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label={copy('Nome de exibição', 'Display name')}
          htmlFor="managed-name"
          required
          error={state.fieldErrors?.name}
        >
          <Input
            id="managed-name"
            name="name"
            defaultValue={values.name}
            maxLength={100}
            required
            autoComplete="name"
            className={inputClass}
            aria-invalid={Boolean(state.fieldErrors?.name)}
            aria-describedby={state.fieldErrors?.name ? 'managed-name-error' : undefined}
          />
        </Field>

        <Field
          label={copy('E-mail de acesso', 'Login email')}
          htmlFor="managed-email"
          hint={copy(
            'Protegido: a troca exige verificação do novo endereço pelo próprio usuário.',
            'Protected: changing it requires the user to verify the new address.',
          )}
        >
          <Input
            id="managed-email"
            value={values.email}
            readOnly
            disabled
            className={inputClass}
          />
        </Field>

        <Field
          label={copy('Idioma preferido', 'Preferred language')}
          htmlFor="managed-language"
          required
          error={state.fieldErrors?.language}
        >
          <Select
            id="managed-language"
            name="language"
            defaultValue={values.language}
            className={inputClass}
            aria-invalid={Boolean(state.fieldErrors?.language)}
            aria-describedby={state.fieldErrors?.language ? 'managed-language-error' : undefined}
          >
            <option value="PT">Português</option>
            <option value="EN">English</option>
          </Select>
        </Field>

        <Field
          label={copy('Fuso horário', 'Time zone')}
          htmlFor="managed-timezone"
          required
          error={state.fieldErrors?.timeZone}
          hint={copy('Usado em agenda, relatórios e notificações.', 'Used for calendar, reports, and notifications.')}
        >
          <Input
            id="managed-timezone"
            name="timeZone"
            defaultValue={values.timeZone}
            list="managed-timezones"
            maxLength={100}
            required
            className={inputClass}
            aria-invalid={Boolean(state.fieldErrors?.timeZone)}
            aria-describedby={[
              'managed-timezone-hint',
              state.fieldErrors?.timeZone ? 'managed-timezone-error' : '',
            ].filter(Boolean).join(' ')}
          />
        </Field>
      </div>

      <datalist id="managed-timezones">
        <option value="America/New_York" />
        <option value="America/Chicago" />
        <option value="America/Denver" />
        <option value="America/Los_Angeles" />
        <option value="America/Sao_Paulo" />
        <option value="UTC" />
      </datalist>

      {values.isAgent ? (
        <fieldset className="border-t border-border-steel pt-6">
          <legend className="mb-4 text-sm font-semibold text-ink">
            {copy('Dados profissionais', 'Professional details')}
          </legend>
          <div className="grid gap-5 md:grid-cols-3">
            <Field
              label={copy('Telefone', 'Phone')}
              htmlFor="managed-phone"
              error={state.fieldErrors?.phone}
            >
              <Input
                id="managed-phone"
                name="phone"
                type="tel"
                defaultValue={values.phone ?? ''}
                maxLength={32}
                autoComplete="tel"
                className={inputClass}
                aria-invalid={Boolean(state.fieldErrors?.phone)}
                aria-describedby={state.fieldErrors?.phone ? 'managed-phone-error' : undefined}
              />
            </Field>
            <Field label="NPN" htmlFor="managed-npn" error={state.fieldErrors?.npn}>
              <Input
                id="managed-npn"
                name="npn"
                defaultValue={values.npn ?? ''}
                maxLength={40}
                className={inputClass}
                aria-invalid={Boolean(state.fieldErrors?.npn)}
                aria-describedby={state.fieldErrors?.npn ? 'managed-npn-error' : undefined}
              />
            </Field>
            <Field
              label={copy('Cargo', 'Rank')}
              htmlFor="managed-rank"
              error={state.fieldErrors?.rank}
              required
            >
              {values.ownsAgency ? (
                <>
                  <input type="hidden" name="rank" value="AGENCY_OWNER" />
                  <Input
                    id="managed-rank"
                    value={copy('Responsável pela agência', 'Agency owner')}
                    readOnly
                    aria-readonly="true"
                    className={inputClass}
                  />
                  <p className="mt-2 text-xs leading-5 text-ink-muted">
                    {copy(
                      'Cargo protegido enquanto este usuário for responsável pela agência.',
                      'Protected while this user owns the agency.',
                    )}
                  </p>
                </>
              ) : (
                <Select
                  id="managed-rank"
                  name="rank"
                  defaultValue={values.rank ?? ''}
                  required
                  className={inputClass}
                  aria-invalid={Boolean(state.fieldErrors?.rank)}
                  aria-describedby={state.fieldErrors?.rank ? 'managed-rank-error' : undefined}
                >
                  {RANKS.map((rank) => (
                    <option key={rank} value={rank}>
                      {rank === 'AGENT'
                        ? copy('Agente', 'Agent')
                        : rank === 'MANAGER'
                          ? copy('Gerente', 'Manager')
                          : copy('Diretor', 'Director')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="phone" value="" />
          <input type="hidden" name="npn" value="" />
          <input type="hidden" name="rank" value="" />
        </>
      )}

      {values.ownsAgency ? (
        <fieldset className="border-t border-border-steel pt-6">
          <legend className="mb-4 text-sm font-semibold text-ink">
            {copy('Agência vinculada', 'Linked agency')}
          </legend>
          <Field
            label={copy('Nome da agência', 'Agency name')}
            htmlFor="managed-agency-name"
            error={state.fieldErrors?.agencyName}
            required
          >
            <Input
              id="managed-agency-name"
              name="agencyName"
              defaultValue={values.agencyName ?? ''}
              maxLength={120}
              required
              className={inputClass}
              aria-invalid={Boolean(state.fieldErrors?.agencyName)}
              aria-describedby={state.fieldErrors?.agencyName ? 'managed-agency-name-error' : undefined}
            />
          </Field>
        </fieldset>
      ) : (
        <input type="hidden" name="agencyName" value="" />
      )}

      {values.isClient ? (
        <fieldset className="border-t border-border-steel pt-6">
          <legend className="mb-4 text-sm font-semibold text-ink">
            {copy('Perfil de cliente', 'Client profile')}
          </legend>
          <div className="grid gap-5 md:grid-cols-3">
            <Field
              label={copy('Nome do cliente', 'Client name')}
              htmlFor="managed-client-name"
              error={state.fieldErrors?.clientName}
              required
            >
              <Input
                id="managed-client-name"
                name="clientName"
                defaultValue={values.clientName ?? ''}
                maxLength={100}
                required
                className={inputClass}
                aria-invalid={Boolean(state.fieldErrors?.clientName)}
                aria-describedby={state.fieldErrors?.clientName ? 'managed-client-name-error' : undefined}
              />
            </Field>
            <Field
              label={copy('E-mail de contato', 'Contact email')}
              htmlFor="managed-client-email"
              error={state.fieldErrors?.clientEmail}
            >
              <Input
                id="managed-client-email"
                name="clientEmail"
                type="email"
                defaultValue={values.clientEmail ?? ''}
                maxLength={254}
                autoComplete="email"
                className={inputClass}
                aria-invalid={Boolean(state.fieldErrors?.clientEmail)}
                aria-describedby={state.fieldErrors?.clientEmail ? 'managed-client-email-error' : undefined}
              />
            </Field>
            <Field
              label={copy('Telefone do cliente', 'Client phone')}
              htmlFor="managed-client-phone"
              error={state.fieldErrors?.clientPhone}
            >
              <Input
                id="managed-client-phone"
                name="clientPhone"
                type="tel"
                defaultValue={values.clientPhone ?? ''}
                maxLength={32}
                autoComplete="tel"
                className={inputClass}
                aria-invalid={Boolean(state.fieldErrors?.clientPhone)}
                aria-describedby={state.fieldErrors?.clientPhone ? 'managed-client-phone-error' : undefined}
              />
            </Field>
          </div>
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="clientName" value="" />
          <input type="hidden" name="clientEmail" value="" />
          <input type="hidden" name="clientPhone" value="" />
        </>
      )}

      <FormFeedback state={state} />
      <div className="flex justify-end border-t border-border-steel pt-5">
        <SubmitButton
          idle={copy('Salvar alterações', 'Save changes')}
          pending={copy('Salvando…', 'Saving…')}
          variant="primary"
        />
      </div>
    </form>
  )
}

function PasswordResetForm({ userId }: { userId: string }) {
  const { copy } = useI18n()
  const [state, action] = useActionState(
    requestManagedUserPasswordResetAction,
    INITIAL_ADMIN_USER_FORM_STATE,
  )
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <p className="text-sm font-semibold text-ink">{copy('Redefinir senha', 'Reset password')}</p>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          {copy(
            'Envia um link seguro por e-mail. O administrador nunca vê nem define a senha.',
            'Sends a secure email link. The administrator never sees or sets the password.',
          )}
        </p>
      </div>
      <FormFeedback state={state} />
      <SubmitButton idle={copy('Enviar redefinição', 'Send reset link')} pending={copy('Enviando…', 'Sending…')} />
    </form>
  )
}

function EmailChangeForm({
  userId,
  currentEmail,
  expectedUpdatedAt,
  pendingEmailChange,
}: {
  userId: string
  currentEmail: string
  expectedUpdatedAt: string
  pendingEmailChange: { newEmail: string; expiresAt: string; currentApproved: boolean } | null
}) {
  const { copy, language } = useI18n()
  const [state, action] = useActionState(
    requestManagedUserEmailChangeAction,
    INITIAL_EMAIL_CHANGE_FORM_STATE,
  )
  const expiresAt = pendingEmailChange
    ? new Intl.DateTimeFormat(language === 'PT' ? 'pt-BR' : 'en-US', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(pendingEmailChange.expiresAt))
    : null

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />
      <div>
        <p className="text-sm font-semibold text-ink">{copy('Trocar e-mail de acesso', 'Change login email')}</p>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          {copy(
            'O endereço atual continua válido. A troca só acontece quando o usuário confirmar pelo novo e-mail.',
            'The current address stays valid. It changes only after the user confirms from the new inbox.',
          )}
        </p>
      </div>

      {pendingEmailChange ? (
        <div className="rounded-lg bg-gold-pale px-3.5 py-3 text-xs leading-5 text-gold-ink">
          <p className="font-semibold">
            {pendingEmailChange.currentApproved
              ? copy('Aguardando o novo e-mail', 'Waiting for the new email')
              : copy('Aguardando o e-mail atual', 'Waiting for the current email')}
          </p>
          <p className="mt-1 break-all">{pendingEmailChange.newEmail}</p>
          <p className="mt-1">{copy('Expira em', 'Expires')} {expiresAt}</p>
        </div>
      ) : null}

      <Field
        label={copy('Novo e-mail', 'New email')}
        htmlFor="managed-new-login-email"
        required
        error={state.fieldErrors?.newEmail}
        hint={`${copy('Atual:', 'Current:')} ${currentEmail}`}
      >
        <Input
          id="managed-new-login-email"
          name="newEmail"
          type="email"
          maxLength={254}
          autoComplete="off"
          inputMode="email"
          required
          className="w-full"
          aria-invalid={Boolean(state.fieldErrors?.newEmail)}
          aria-describedby={state.fieldErrors?.newEmail
            ? 'managed-new-login-email-error'
            : 'managed-new-login-email-hint'}
        />
      </Field>
      <FormFeedback state={state} />
      <SubmitButton
        idle={pendingEmailChange
          ? copy('Substituir solicitação', 'Replace request')
          : copy('Enviar confirmação', 'Send confirmation')}
        pending={copy('Enviando…', 'Sending…')}
      />
    </form>
  )
}

function VerificationForm({ userId }: { userId: string }) {
  const { copy } = useI18n()
  const [state, action] = useActionState(
    resendManagedUserVerificationAction,
    INITIAL_ADMIN_USER_FORM_STATE,
  )
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <p className="text-sm font-semibold text-ink">{copy('Verificar e-mail', 'Verify email')}</p>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          {copy('Reenvia a confirmação para o endereço de acesso.', 'Resends confirmation to the login address.')}
        </p>
      </div>
      <FormFeedback state={state} />
      <SubmitButton idle={copy('Reenviar verificação', 'Resend verification')} pending={copy('Enviando…', 'Sending…')} />
    </form>
  )
}

function RevokeSessionsForm({ userId, sessionCount }: { userId: string; sessionCount: number }) {
  const { copy } = useI18n()
  const [state, action] = useActionState(
    revokeManagedUserSessionsAction,
    INITIAL_ADMIN_USER_FORM_STATE,
  )
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <p className="text-sm font-semibold text-ink">{copy('Encerrar sessões', 'Revoke sessions')}</p>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          {copy(
            `${sessionCount} sessão(ões) serão desconectadas em todos os dispositivos.`,
            `${sessionCount} session(s) will be signed out on every device.`,
          )}
        </p>
      </div>
      <label className="flex items-start gap-2.5 rounded-lg bg-danger-pale px-3.5 py-3 text-xs leading-5 text-danger">
        <input type="checkbox" required className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-danger)]" />
        <span>{copy('Confirmo que desejo desconectar todos os dispositivos deste usuário.', 'I confirm that I want to sign this user out on every device.')}</span>
      </label>
      <FormFeedback state={state} />
      <SubmitButton
        idle={copy('Encerrar todas', 'Revoke all')}
        pending={copy('Encerrando…', 'Revoking…')}
        variant="danger"
        className="disabled:opacity-40"
      />
    </form>
  )
}

function AccessForm({
  userId,
  accessStatus,
  banReason,
}: {
  userId: string
  accessStatus: 'ACTIVE' | 'SUSPENDED'
  banReason: string | null
}) {
  const { copy } = useI18n()
  const [state, action] = useActionState(
    updateManagedUserAccessAction,
    INITIAL_ADMIN_USER_FORM_STATE,
  )
  const suspended = accessStatus === 'SUSPENDED'
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="intent" value={suspended ? 'RESTORE' : 'SUSPEND'} />
      <div>
        <p className="text-sm font-semibold text-ink">
          {suspended ? copy('Restaurar acesso', 'Restore access') : copy('Suspender conta', 'Suspend account')}
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          {suspended
            ? copy('Libera novos acessos sem alterar o plano contratado.', 'Allows sign-in again without changing the subscribed plan.')
            : copy('Bloqueia novos acessos e encerra todas as sessões, sem cancelar a assinatura.', 'Blocks sign-in and revokes all sessions without canceling the subscription.')}
        </p>
      </div>
      {suspended ? (
        <>
          <input type="hidden" name="reason" value="" />
          {banReason ? (
            <p className="rounded-lg bg-danger-pale px-3.5 py-3 text-xs leading-5 text-danger">
              <strong>{copy('Motivo registrado:', 'Recorded reason:')}</strong> {banReason}
            </p>
          ) : null}
        </>
      ) : (
        <Field
          label={copy('Motivo da suspensão', 'Suspension reason')}
          htmlFor="managed-suspension-reason"
          required
          error={state.fieldErrors?.reason}
        >
          <textarea
            id="managed-suspension-reason"
            name="reason"
            rows={3}
            minLength={5}
            maxLength={240}
            required
            className="w-full resize-y rounded-xl border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus-visible:border-teal focus-visible:ring-[3px] focus-visible:ring-teal-pale"
            aria-invalid={Boolean(state.fieldErrors?.reason)}
            aria-describedby={state.fieldErrors?.reason ? 'managed-suspension-reason-error' : undefined}
          />
        </Field>
      )}
      <FormFeedback state={state} />
      <SubmitButton
        idle={suspended ? copy('Restaurar acesso', 'Restore access') : copy('Suspender conta', 'Suspend account')}
        pending={suspended ? copy('Restaurando…', 'Restoring…') : copy('Suspendendo…', 'Suspending…')}
        variant={suspended ? 'secondary' : 'danger'}
      />
    </form>
  )
}

export function ManagedUserSecurityControls({
  userId,
  email,
  expectedUpdatedAt,
  pendingEmailChange,
  accessStatus,
  banReason,
  emailVerified,
  sessionCount,
  isCurrentUser,
  role,
}: {
  userId: string
  email: string
  expectedUpdatedAt: string
  pendingEmailChange: { newEmail: string; expiresAt: string; currentApproved: boolean } | null
  accessStatus: 'ACTIVE' | 'SUSPENDED'
  banReason: string | null
  emailVerified: boolean
  sessionCount: number
  isCurrentUser: boolean
  role: 'ADMIN' | 'AGENT' | 'CLIENT'
}) {
  const { copy } = useI18n()
  if (accessStatus === 'SUSPENDED') {
    return (
      <div className="space-y-5">
        <p className="rounded-lg bg-gold-pale px-3.5 py-3 text-xs leading-5 text-gold-ink">
          {copy(
            'Enquanto a conta estiver suspensa, envio de senha, verificação e gestão de sessões ficam indisponíveis.',
            'Password email, verification, and session controls are unavailable while the account is suspended.',
          )}
        </p>
        <AccessForm userId={userId} accessStatus={accessStatus} banReason={banReason} />
      </div>
    )
  }
  return (
    <div className="divide-y divide-border-steel">
      <div className="pb-5"><PasswordResetForm userId={userId} /></div>
      {!isCurrentUser && role !== 'ADMIN' ? (
        <div className="py-5">
          <EmailChangeForm
            userId={userId}
            currentEmail={email}
            expectedUpdatedAt={expectedUpdatedAt}
            pendingEmailChange={pendingEmailChange}
          />
        </div>
      ) : (
        <div className="py-5">
          <p className="rounded-lg bg-panel px-3.5 py-3 text-xs leading-5 text-ink-muted">
            {isCurrentUser
              ? copy(
                  'Para proteger o painel, troque o e-mail da sua própria conta fora desta gestão.',
                  'To protect admin access, change your own email outside this management panel.',
                )
              : copy(
                  'O e-mail de contas administrativas é protegido neste painel.',
                  'Administrative account emails are protected in this panel.',
                )}
          </p>
        </div>
      )}
      {!emailVerified ? <div className="py-5"><VerificationForm userId={userId} /></div> : null}
      {!isCurrentUser && sessionCount > 0 ? (
        <div className="py-5"><RevokeSessionsForm userId={userId} sessionCount={sessionCount} /></div>
      ) : null}
      <div className="pt-5">
        {role === 'ADMIN' ? (
          <p className="rounded-lg bg-panel px-3.5 py-3 text-xs leading-5 text-ink-muted">
            {copy(
              'Contas administrativas são protegidas contra suspensão neste painel.',
              'Administrative accounts are protected from suspension in this panel.',
            )}
          </p>
        ) : isCurrentUser ? (
          <p className="rounded-lg bg-panel px-3.5 py-3 text-xs leading-5 text-ink-muted">
            {copy(
              'Para proteger o painel, sua própria conta não pode ser suspensa aqui.',
              'To protect the admin panel, your own account cannot be suspended here.',
            )}
          </p>
        ) : (
          <AccessForm userId={userId} accessStatus={accessStatus} banReason={banReason} />
        )}
      </div>
    </div>
  )
}
