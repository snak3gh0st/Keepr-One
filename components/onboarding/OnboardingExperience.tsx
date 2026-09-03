"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  saveOnboardingProfileAction,
  setCalendarOnboardingDecisionAction,
  setWhatsAppOnboardingDecisionAction,
  verifyNationalLifeOnboardingAction,
} from "@/app/onboarding/actions";
import {
  INITIAL_ONBOARDING_ACTION_STATE,
  type OnboardingActionState,
} from "@/app/onboarding/state";
import { ConnectOfficialWhatsapp } from "@/app/agent/mensagens/ConnectOfficialWhatsapp";
import { ConnectWhatsapp } from "@/app/agent/mensagens/ConnectWhatsapp";
import {
  NationalLifeLocalConnectorCard,
  type NationalLifeConnectorViewState,
} from "@/app/agent/integrations/national-life/NationalLifeLocalConnectorCard";
import { Field, Input } from "@/components/Field";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { KBotAvatar, type KBotState } from "@/components/kbot/KBotAvatar";
import { Logo } from "@/components/Logo";
import type {
  AgentOnboardingPageData,
  AgentOnboardingView,
} from "@/lib/agent-onboarding";
import type { WhatsappChannelMode } from "@/lib/messaging/channel-mode";
import type { PublicLocalConnectorConfig } from "@/lib/national-life/local-connector/config";
import { OnboardingIcon } from "./OnboardingIcon";
import { OnboardingMotion } from "./OnboardingMotion";

type DurableStep = AgentOnboardingView["currentStep"];
type VisibleStep = "PROFILE" | "NATIONAL_LIFE" | "CALENDAR" | "WHATSAPP";

export type OnboardingExperienceProps = AgentOnboardingPageData & {
  onboarding: AgentOnboardingView;
  nationalLifeConfig: PublicLocalConnectorConfig;
  calendarConfigured: boolean;
  calendarResult?: string | null;
  whatsapp: {
    available: boolean;
    mode: WhatsappChannelMode;
  };
};

const VISIBLE_STEPS = [
  { key: "PROFILE", icon: "profile" },
  { key: "NATIONAL_LIFE", icon: "national-life" },
  { key: "CALENDAR", icon: "google-calendar" },
  { key: "WHATSAPP", icon: "whatsapp" },
] as const satisfies readonly {
  key: VisibleStep;
  icon: "profile" | "national-life" | "google-calendar" | "whatsapp";
}[];

function visibleStep(step: DurableStep): VisibleStep {
  if (step === "WELCOME" || step === "PROFILE") return "PROFILE";
  if (step === "NATIONAL_LIFE") return "NATIONAL_LIFE";
  if (step === "CALENDAR") return "CALENDAR";
  return "WHATSAPP";
}

function indexFor(step: VisibleStep): number {
  return VISIBLE_STEPS.findIndex((item) => item.key === step);
}

function stepLabel(
  step: VisibleStep,
  copy: (portuguese: string, english: string) => string,
) {
  switch (step) {
    case "PROFILE":
      return copy("Seus dados", "Your details");
    case "NATIONAL_LIFE":
      return "K-Bot";
    case "CALENDAR":
      return copy("Agenda", "Calendar");
    case "WHATSAPP":
      return "WhatsApp";
  }
}

function latestOnboarding(
  fallback: AgentOnboardingView,
  states: readonly OnboardingActionState[],
): AgentOnboardingView {
  return states.reduce(
    (current, state) => state.onboarding ?? current,
    fallback,
  );
}

function fieldError(state: OnboardingActionState, name: string) {
  return state.fieldErrors?.[name];
}

function describedBy(id: string, error?: string, hasHint = false) {
  return [hasHint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;
}

function ActionFeedback({ state, id }: { state: OnboardingActionState; id: string }) {
  if (!state.message) return null;
  return (
    <p
      id={id}
      role={state.status === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`onboarding-feedback ${state.status === "error" ? "is-error" : "is-success"}`}
    >
      {state.message}
    </p>
  );
}

function PrimarySubmit({
  label,
  pendingLabel,
  pending,
  disabled = false,
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      className="onboarding-primary-action"
      disabled={pending || disabled}
      aria-busy={pending}
    >
      <span>{pending ? pendingLabel : label}</span>
      <OnboardingIcon name="arrow-right" />
    </button>
  );
}

function OnboardingHeader({ currentIndex }: { currentIndex: number }) {
  const { copy, language } = useI18n();
  const percent = ((currentIndex + 1) / VISIBLE_STEPS.length) * 100;

  return (
    <header className="onboarding-header">
      <div className="onboarding-header-inner">
        <Logo size={31} className="text-white" />
        <p>
          <span>{copy("Configuração inicial", "Initial setup")}</span>
          <strong>{language === "PT" ? `Etapa ${currentIndex + 1} de 4` : `Step ${currentIndex + 1} of 4`}</strong>
        </p>
        <LanguageSwitcher inverse />
      </div>
      <div
        className="onboarding-progress-line"
        role="progressbar"
        aria-label={copy("Progresso da configuração", "Setup progress")}
        aria-valuemin={1}
        aria-valuemax={4}
        aria-valuenow={currentIndex + 1}
      >
        <span style={{ "--onboarding-progress": percent / 100 } as CSSProperties} />
      </div>
    </header>
  );
}

function StepNavigation({
  currentStep,
  viewedStep,
  onView,
}: {
  currentStep: VisibleStep;
  viewedStep: VisibleStep;
  onView: (step: VisibleStep) => void;
}) {
  const { copy } = useI18n();
  const currentIndex = indexFor(currentStep);

  return (
    <nav className="onboarding-step-navigation" aria-label={copy("Etapas do onboarding", "Onboarding steps")}>
      <ol>
        {VISIBLE_STEPS.map((step, index) => {
          const complete = index < currentIndex;
          const current = index === currentIndex;
          const available = index <= currentIndex;
          const selected = step.key === viewedStep;
          return (
            <li key={step.key} data-state={complete ? "complete" : current ? "current" : "upcoming"}>
              <button
                type="button"
                disabled={!available}
                aria-current={selected ? "step" : undefined}
                onClick={() => onView(step.key)}
              >
                <span className="onboarding-step-number" aria-hidden="true">
                  {complete ? <OnboardingIcon name="check" /> : index + 1}
                </span>
                <span>
                  <strong>{stepLabel(step.key, copy)}</strong>
                  <small>
                    {complete
                      ? copy("Concluída", "Completed")
                      : current
                        ? copy("Agora", "Now")
                        : copy("Em seguida", "Next")}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function KBotGuide({
  step,
  profileName,
  nationalLifeState,
  calendarConnected,
  whatsappConnected,
  connectorState,
  feedback,
}: {
  step: VisibleStep;
  profileName: string;
  nationalLifeState: AgentOnboardingPageData["integrations"]["nationalLife"];
  calendarConnected: boolean;
  whatsappConnected: boolean;
  connectorState: NationalLifeConnectorViewState | null;
  feedback: OnboardingActionState;
}) {
  const { copy } = useI18n();
  const firstName = profileName.trim().split(/\s+/)[0] || copy("por aí", "there");

  const guidance = useMemo(() => {
    if (feedback.message) {
      return {
        state: feedback.status === "error" ? "error" as const : "success" as const,
        eyebrow: feedback.status === "error" ? copy("Vamos resolver", "Let's fix this") : copy("Tudo certo", "All set"),
        title: feedback.message,
        detail: feedback.status === "error"
          ? copy("Confira a indicação na tela. Se precisar, tente novamente com calma.", "Check the guidance on screen. You can try again when ready.")
          : copy("Seu progresso já foi salvo. Podemos seguir.", "Your progress is saved. We can continue."),
      };
    }

    if (step === "PROFILE") {
      return {
        state: "idle" as const,
        eyebrow: copy("Olá, {name}", "Hello, {name}").replace("{name}", firstName),
        title: copy("Eu sou o K-Bot. Vou acompanhar você do começo ao fim.", "I'm K-Bot. I'll stay with you from start to finish."),
        detail: copy("Comece pelos seus dados básicos. O NPN pode ficar para depois.", "Start with your basic details. You can add your NPN later."),
      };
    }

    if (step === "NATIONAL_LIFE") {
      if (connectorState?.phase === "error") {
        return {
          state: "error" as const,
          eyebrow: copy("Preciso da sua atenção", "I need your attention"),
          title: copy("Não consegui terminar esta parte ainda.", "I couldn't finish this part yet."),
          detail: copy("Siga a orientação no cartão ao lado. Tudo que já foi processado continua seguro.", "Follow the guidance in the card. Everything already processed remains safe."),
        };
      }
      if (connectorState?.phase === "login-required") {
        return {
          state: "waiting" as const,
          eyebrow: copy("Sua vez", "Your turn"),
          title: copy("Entre na National Life para eu continuar.", "Sign in to National Life so I can continue."),
          detail: copy("Depois do login, eu retomo a mesma tarefa automaticamente.", "After you sign in, I'll resume the same task automatically."),
        };
      }
      if (connectorState?.syncActive) {
        return {
          state: "working" as const,
          eyebrow: copy("Estou trabalhando", "I'm working"),
          title: copy("Agora pode deixar comigo. Estou organizando seus dados.", "You can leave this to me now. I'm organizing your data."),
          detail: connectorState.progress === null
            ? copy("Eu aviso assim que o processamento terminar.", "I'll let you know when processing is finished.")
            : copy("O progresso aparece ao lado e fica salvo por etapa.", "Progress appears alongside and is saved step by step."),
        };
      }
      if (nationalLifeState === "VERIFIED_SYNC") {
        return {
          state: "success" as const,
          eyebrow: copy("Dados processados", "Data processed"),
          title: copy("Terminei a primeira organização da sua carteira.", "I finished organizing your book for the first time."),
          detail: copy("A origem dos dados foi verificada. Agora é só continuar.", "The data source was verified. You can continue now."),
        };
      }
      if (nationalLifeState === "CONNECTOR_PAIRED") {
        return {
          state: "working" as const,
          eyebrow: copy("Computador conectado", "Computer connected"),
          title: copy("Ótimo. Agora entre na National Life e eu cuido do processamento.", "Great. Sign in to National Life and I'll handle the processing."),
          detail: copy("Pode deixar esta tela aberta. Eu aviso assim que terminar.", "Keep this screen open. I'll let you know when I'm done."),
        };
      }
      return {
        state: "waiting" as const,
        eyebrow: copy("Primeiro acesso", "First access"),
        title: copy("Vamos me instalar neste navegador. Leva só alguns passos.", "Let's install me in this browser. It only takes a few steps."),
        detail: copy("Use Chrome ou Edge. Depois da instalação, eu continuo daqui automaticamente.", "Use Chrome or Edge. After installation, I'll continue from here automatically."),
      };
    }

    if (step === "CALENDAR") {
      return {
        state: calendarConnected ? "success" as const : "idle" as const,
        eyebrow: calendarConnected ? copy("Agenda conectada", "Calendar connected") : copy("Etapa opcional", "Optional step"),
        title: calendarConnected
          ? copy("Seu Google Calendar já está comigo.", "Your Google Calendar is connected.")
          : copy("Posso organizar compromissos sem criar conflito de horário.", "I can organize appointments without double-booking you."),
        detail: calendarConnected
          ? copy("Os compromissos passam a aparecer na Keepr One.", "Your appointments will now appear in Keepr One.")
          : copy("Se preferir, pule agora e conecte quando estiver no painel.", "You can skip this and connect it later from your dashboard."),
      };
    }

    return {
      state: whatsappConnected ? "success" as const : "idle" as const,
      eyebrow: whatsappConnected ? copy("WhatsApp conectado", "WhatsApp connected") : copy("Última etapa", "Last step"),
      title: whatsappConnected
        ? copy("Pronto. Suas conversas já podem acompanhar sua operação.", "Done. Your conversations can now follow your workflow.")
        : copy("Só falta decidir se quer conectar o WhatsApp agora.", "Just decide whether to connect WhatsApp now."),
      detail: copy("Essa escolha também pode ficar para depois. Nada será perdido.", "You can also do this later. Nothing will be lost."),
    };
  }, [calendarConnected, connectorState, copy, feedback.message, feedback.status, firstName, nationalLifeState, step, whatsappConnected]);

  return (
    <aside className="onboarding-assistant" data-onboarding-assistant aria-label={copy("Ajuda do K-Bot", "K-Bot guidance")}>
      <div className="onboarding-assistant-head">
        <KBotAvatar state={guidance.state satisfies KBotState} size="lg" />
        <div>
          <span>K-Bot</span>
          <small>{copy("Seu guia nesta configuração", "Your setup guide")}</small>
        </div>
      </div>

      <div className="onboarding-speech" role="status" aria-live="polite" aria-atomic="true">
        <span>{guidance.eyebrow}</span>
        <h2>{guidance.title}</h2>
        <p>{guidance.detail}</p>
      </div>

      <div className="onboarding-feedback-dots" aria-hidden="true">
        {VISIBLE_STEPS.map((item) => <span key={item.key} className={item.key === step ? "is-active" : ""} />)}
      </div>

      <p className="onboarding-saved-note">
        <OnboardingIcon name="check" />
        {copy("Cada etapa concluída fica salva automaticamente.", "Every completed step is saved automatically.")}
      </p>
    </aside>
  );
}

function StepIntro({
  id,
  number,
  eyebrow,
  title,
  description,
}: {
  id: string;
  number: number;
  eyebrow: string;
  title: string;
  description: string;
}) {
  const { copy } = useI18n();
  return (
    <header className="onboarding-step-intro">
      <p>{copy("Etapa {number} de 4", "Step {number} of 4").replace("{number}", String(number))} · {eyebrow}</p>
      <h1 id={id}>{title}</h1>
      <span>{description}</span>
    </header>
  );
}

function ReturnToCurrent({ onClick }: { onClick: () => void }) {
  const { copy } = useI18n();
  return (
    <div className="onboarding-return-current">
      <p>{copy("Esta etapa já está salva.", "This step is already saved.")}</p>
      <button type="button" onClick={onClick}>
        {copy("Voltar para a etapa atual", "Return to the current step")}
        <OnboardingIcon name="arrow-right" />
      </button>
    </div>
  );
}

function ProfileStep({
  profile,
  state,
  action,
  pending,
  isCurrent,
  onReturn,
}: {
  profile: AgentOnboardingPageData["profile"];
  state: OnboardingActionState;
  action: (payload: FormData) => void;
  pending: boolean;
  isCurrent: boolean;
  onReturn: () => void;
}) {
  const { copy } = useI18n();
  const nameError = fieldError(state, "name");
  const phoneError = fieldError(state, "phone");
  const npnError = fieldError(state, "npn");

  return (
    <section className="onboarding-step-card" data-onboarding-step-card aria-labelledby="onboarding-profile-title">
      <StepIntro
        id="onboarding-profile-title"
        number={1}
        eyebrow={copy("Preenchimento dos dados", "Your details")}
        title={copy("Vamos começar pelo básico.", "Let's start with the basics.")}
        description={copy("São apenas três informações. Você leva menos de um minuto.", "Just three details. It takes less than a minute.")}
      />

      <form action={action} className="onboarding-profile-form" aria-describedby={state.message ? "onboarding-profile-feedback" : undefined}>
        <input type="hidden" name="timeZone" value={profile.timeZone} />
        <Field label={copy("Nome completo", "Full name")} htmlFor="onboarding-name" error={nameError} required>
          <Input
            id="onboarding-name"
            name="name"
            autoComplete="name"
            maxLength={100}
            defaultValue={profile.name}
            placeholder={copy("Como podemos chamar você?", "What should we call you?")}
            required
            disabled={!isCurrent || pending}
            aria-invalid={Boolean(nameError)}
            aria-describedby={describedBy("onboarding-name", nameError)}
          />
        </Field>
        <Field label={copy("Telefone", "Phone")} htmlFor="onboarding-phone" hint={copy("Use um número que você acessa com frequência.", "Use a number you check regularly.")} error={phoneError} required>
          <Input
            id="onboarding-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={32}
            defaultValue={profile.phone}
            placeholder="+1 305 555 0100"
            required
            disabled={!isCurrent || pending}
            aria-invalid={Boolean(phoneError)}
            aria-describedby={describedBy("onboarding-phone", phoneError, true)}
          />
        </Field>
        <Field label="NPN" htmlFor="onboarding-npn" hint={copy("Opcional. Você pode informar depois em Configurações.", "Optional. You can add it later in Settings.")} error={npnError}>
          <Input
            id="onboarding-npn"
            name="npn"
            inputMode="numeric"
            autoComplete="off"
            minLength={4}
            maxLength={20}
            pattern="[0-9]{4,20}"
            defaultValue={profile.npn}
            placeholder={copy("Somente números", "Numbers only")}
            disabled={!isCurrent || pending}
            aria-invalid={Boolean(npnError)}
            aria-describedby={describedBy("onboarding-npn", npnError, true)}
          />
        </Field>

        <ActionFeedback state={state} id="onboarding-profile-feedback" />
        {isCurrent ? (
          <div className="onboarding-action-row is-end">
            <PrimarySubmit
              label={copy("Salvar e continuar", "Save and continue")}
              pendingLabel={copy("Salvando…", "Saving…")}
              pending={pending}
            />
          </div>
        ) : <ReturnToCurrent onClick={onReturn} />}
      </form>
    </section>
  );
}

function KBotSetupStep({
  integrationState,
  config,
  connectorState,
  state,
  action,
  pending,
  isCurrent,
  onReturn,
  onConnectorStateChange,
}: {
  integrationState: AgentOnboardingPageData["integrations"]["nationalLife"];
  config: PublicLocalConnectorConfig;
  connectorState: NationalLifeConnectorViewState | null;
  state: OnboardingActionState;
  action: (payload: FormData) => void;
  pending: boolean;
  isCurrent: boolean;
  onReturn: () => void;
  onConnectorStateChange: (state: NationalLifeConnectorViewState) => void;
}) {
  const { copy } = useI18n();
  const phase = connectorState?.phase;
  const installed = connectorState?.presence === "installed" || integrationState !== "NOT_CONNECTED";
  const processed = integrationState === "VERIFIED_SYNC";
  const sessionReady = processed || phase === "syncing" || phase === "slow" || phase === "partial" || phase === "success";
  const processingActive = connectorState?.syncActive || phase === "partial";

  const substeps = [
    {
      title: copy("Instalação", "Installation"),
      detail: installed
        ? copy("K-Bot encontrado", "K-Bot found")
        : phase === "checking"
          ? copy("Verificando o navegador", "Checking your browser")
          : copy("Adicionar ao Chrome ou Edge", "Add to Chrome or Edge"),
      state: installed ? "complete" : "current",
    },
    {
      title: copy("Início da sessão", "Sign in"),
      detail: sessionReady
        ? copy("Sessão confirmada", "Session confirmed")
        : phase === "login-required"
          ? copy("Aguardando seu login", "Waiting for your sign-in")
          : installed
            ? copy("Entrar na National Life", "Sign in to National Life")
            : copy("Depois da instalação", "After installation"),
      state: sessionReady ? "complete" : installed ? "current" : "waiting",
    },
    {
      title: copy("Processamento", "Processing"),
      detail: processed || phase === "success"
        ? copy("Dados verificados", "Data verified")
        : processingActive
          ? copy("Organizando seus dados", "Organizing your data")
          : copy("O K-Bot fará sozinho", "K-Bot handles this"),
      state: processed || phase === "success" ? "complete" : processingActive ? "current" : "waiting",
    },
  ] as const;

  return (
    <section className="onboarding-step-card onboarding-kbot-step" data-onboarding-step-card aria-labelledby="onboarding-kbot-title">
      <StepIntro
        id="onboarding-kbot-title"
        number={2}
        eyebrow={copy("Configuração do K-Bot", "K-Bot setup")}
        title={copy("Prepare o K-Bot para trabalhar com você.", "Get K-Bot ready to work with you.")}
        description={copy("Eu acompanho a instalação, espero seu login e processo os dados. Você só precisa seguir a indicação ativa.", "I'll guide installation, wait for your sign-in, and process the data. Just follow the active instruction.")}
      />

      <ol className="onboarding-kbot-substeps" aria-label={copy("Etapas da configuração do K-Bot", "K-Bot setup steps")}>
        {substeps.map((substep, index) => (
          <li key={substep.title} data-state={substep.state}>
            <span aria-hidden="true">{substep.state === "complete" ? <OnboardingIcon name="check" /> : index + 1}</span>
            <div><strong>{substep.title}</strong><small>{substep.detail}</small></div>
          </li>
        ))}
      </ol>

      {isCurrent && config.enabled && !processed ? (
        <div className="onboarding-connector-shell">
          <NationalLifeLocalConnectorCard
            extensionId={config.extensionTarget}
            storeUrl={config.storeUrl}
            installMode={config.installMode}
            baseUrl={config.baseUrl}
            variant="onboarding"
            showCornerPresence={false}
            onStateChange={onConnectorStateChange}
          />
        </div>
      ) : null}

      {isCurrent && !config.enabled ? (
        <div className="onboarding-unavailable" role="status">
          <strong>{copy("O K-Bot ainda não foi liberado neste ambiente.", "K-Bot is not enabled in this environment yet.")}</strong>
          <p>{copy("A equipe Keepr One precisa habilitar a conexão antes que você avance. Seus dados preenchidos continuam salvos.", "The Keepr One team needs to enable the connection before you can continue. Your details remain saved.")}</p>
        </div>
      ) : null}

      {processed ? (
        <div className="onboarding-success-summary">
          <OnboardingIcon name="check" />
          <div>
            <strong>{copy("Primeiro processamento concluído", "First processing complete")}</strong>
            <p>{copy("Os dados da National Life foram verificados e organizados.", "Your National Life data was verified and organized.")}</p>
          </div>
        </div>
      ) : null}

      <ActionFeedback state={state} id="onboarding-kbot-feedback" />
      {isCurrent && processed ? (
        <form action={action} className="onboarding-action-row is-end" aria-describedby={state.message ? "onboarding-kbot-feedback" : undefined}>
          <PrimarySubmit
            label={copy("Continuar", "Continue")}
            pendingLabel={copy("Verificando…", "Checking…")}
            pending={pending}
          />
        </form>
      ) : !isCurrent ? <ReturnToCurrent onClick={onReturn} /> : null}
    </section>
  );
}

function IntegrationBenefit({
  icon,
  title,
  detail,
}: {
  icon: "google-calendar" | "whatsapp";
  title: string;
  detail: string;
}) {
  return (
    <div className="onboarding-integration-benefit">
      <span><OnboardingIcon name={icon} /></span>
      <div><strong>{title}</strong><p>{detail}</p></div>
    </div>
  );
}

function CalendarStep({
  connected,
  configured,
  result,
  state,
  action,
  pending,
  isCurrent,
  onReturn,
}: {
  connected: boolean;
  configured: boolean;
  result: string | null;
  state: OnboardingActionState;
  action: (payload: FormData) => void;
  pending: boolean;
  isCurrent: boolean;
  onReturn: () => void;
}) {
  const { copy } = useI18n();
  return (
    <section className="onboarding-step-card" data-onboarding-step-card aria-labelledby="onboarding-calendar-title">
      <StepIntro
        id="onboarding-calendar-title"
        number={3}
        eyebrow="Google Calendar"
        title={copy("Conecte sua agenda, se quiser.", "Connect your calendar, if you'd like.")}
        description={copy("É opcional. A conexão ajuda a reunir seus compromissos e evitar conflitos de horário.", "This is optional. Connecting brings your appointments together and helps prevent scheduling conflicts.")}
      />

      <IntegrationBenefit
        icon="google-calendar"
        title={connected ? copy("Google Calendar conectado", "Google Calendar connected") : copy("Uma agenda sempre atualizada", "One always-current calendar")}
        detail={connected
          ? copy("A conexão foi verificada. Você pode continuar.", "The connection was verified. You can continue.")
          : copy("Compromissos do Google aparecem na Keepr One e horários ocupados ficam protegidos.", "Google appointments appear in Keepr One, and busy times stay protected.")}
      />

      {!configured && isCurrent ? (
        <div className="onboarding-unavailable" role="status">
          <strong>{copy("A conexão Google ainda não está disponível aqui.", "Google connection is not available here yet.")}</strong>
          <p>{copy("Você pode continuar e configurar depois sem perder o progresso.", "You can continue and set it up later without losing progress.")}</p>
        </div>
      ) : null}

      {isCurrent && result && result !== "connected" ? (
        <p className="onboarding-feedback is-error" role="alert">
          {result === "denied"
            ? copy("A conexão não foi autorizada. Você pode tentar novamente ou fazer isso depois.", "Calendar access wasn't authorized. You can try again or do this later.")
            : result === "missing-scopes"
              ? copy("O Google não liberou todas as permissões necessárias. Tente conectar novamente.", "Google did not grant all required permissions. Please connect again.")
              : result === "unverified-email"
                ? copy("Use uma conta Google com e-mail verificado para conectar a agenda.", "Use a Google account with a verified email address.")
                : copy("Não consegui concluir a conexão agora. Tente novamente ou faça isso depois.", "I couldn't finish connecting right now. Try again or do this later.")}
        </p>
      ) : null}

      <ActionFeedback state={state} id="onboarding-calendar-feedback" />
      {isCurrent ? (
        <div className="onboarding-action-row">
          <form action={action}>
            <input type="hidden" name="decision" value="SKIPPED" />
            <button type="submit" className="onboarding-secondary-action" disabled={pending}>
              {copy("Fazer depois", "Do this later")}
            </button>
          </form>
          {connected ? (
            <form action={action}>
              <input type="hidden" name="decision" value="CONNECTED" />
              <PrimarySubmit label={copy("Continuar", "Continue")} pendingLabel={copy("Validando…", "Verifying…")} pending={pending} />
            </form>
          ) : configured ? (
            <Link className="onboarding-primary-action" href="/api/agent/integrations/google-calendar/authorize?returnTo=/onboarding">
              <span>{copy("Conectar Google Calendar", "Connect Google Calendar")}</span>
              <OnboardingIcon name="arrow-right" />
            </Link>
          ) : null}
        </div>
      ) : <ReturnToCurrent onClick={onReturn} />}
    </section>
  );
}

function WhatsAppStep({
  connected,
  available,
  mode,
  state,
  action,
  pending,
  isCurrent,
  onReturn,
  onConnectionChange,
}: {
  connected: boolean;
  available: boolean;
  mode: WhatsappChannelMode;
  state: OnboardingActionState;
  action: (payload: FormData) => void;
  pending: boolean;
  isCurrent: boolean;
  onReturn: () => void;
  onConnectionChange: (connected: boolean) => void;
}) {
  const { copy } = useI18n();
  const [showSetup, setShowSetup] = useState(false);

  return (
    <section className="onboarding-step-card" data-onboarding-step-card aria-labelledby="onboarding-whatsapp-title">
      <StepIntro
        id="onboarding-whatsapp-title"
        number={4}
        eyebrow="WhatsApp"
        title={copy("Última escolha: conectar suas conversas.", "One last choice: connect your conversations.")}
        description={copy("Também é opcional. Se conectar agora, suas conversas ficam próximas dos clientes e tarefas.", "This is optional too. Connect now to keep conversations close to clients and tasks.")}
      />

      <IntegrationBenefit
        icon="whatsapp"
        title={connected ? copy("WhatsApp conectado", "WhatsApp connected") : copy("Conversas no contexto certo", "Conversations in the right context")}
        detail={connected
          ? copy("A conexão foi confirmada. Seu painel está pronto.", "The connection is confirmed. Your dashboard is ready.")
          : copy("Acompanhe mensagens sem perder o histórico do relacionamento.", "Follow messages without losing the relationship history.")}
      />

      {!available && isCurrent ? (
        <div className="onboarding-unavailable" role="status">
          <strong>{copy("O WhatsApp ainda não está liberado para esta conta.", "WhatsApp is not enabled for this account yet.")}</strong>
          <p>{copy("Entre no painel agora e configure assim que a opção estiver disponível.", "Enter the dashboard now and configure it when it becomes available.")}</p>
        </div>
      ) : null}

      {available && isCurrent && !connected ? (
        <div className="onboarding-expandable">
          <button type="button" onClick={() => setShowSetup((value) => !value)} aria-expanded={showSetup}>
            <span>
              <strong>{copy("Conectar agora", "Connect now")}</strong>
              <small>{copy("Abra o passo a passo sem sair desta tela", "Open the guided setup without leaving this screen")}</small>
            </span>
            <span aria-hidden="true">{showSetup ? "−" : "+"}</span>
          </button>
          {showSetup ? (
            <div className="onboarding-whatsapp-setup">
              {mode === "META_CLOUD"
                ? <ConnectOfficialWhatsapp onConnectionChange={onConnectionChange} />
                : <ConnectWhatsapp onConnectionChange={onConnectionChange} />}
            </div>
          ) : null}
        </div>
      ) : null}

      <ActionFeedback state={state} id="onboarding-whatsapp-feedback" />
      {isCurrent ? (
        <div className="onboarding-action-row">
          {!connected ? (
            <form action={action}>
              <input type="hidden" name="decision" value="SKIPPED" />
              <button type="submit" className="onboarding-secondary-action" disabled={pending}>
                {copy("Fazer depois e entrar", "Do this later and enter")}
              </button>
            </form>
          ) : null}
          {connected ? (
            <form action={action}>
              <input type="hidden" name="decision" value="CONNECTED" />
              <PrimarySubmit label={copy("Entrar na Keepr One", "Enter Keepr One")} pendingLabel={copy("Preparando seu painel…", "Preparing your dashboard…")} pending={pending} />
            </form>
          ) : null}
        </div>
      ) : <ReturnToCurrent onClick={onReturn} />}
    </section>
  );
}

export function OnboardingExperience({
  onboarding,
  profile,
  integrations,
  nationalLifeConfig,
  calendarConfigured,
  calendarResult = null,
  whatsapp,
}: OnboardingExperienceProps) {
  const { copy } = useI18n();
  const [profileState, profileAction, profilePending] = useActionState(saveOnboardingProfileAction, INITIAL_ONBOARDING_ACTION_STATE);
  const [nationalLifeState, nationalLifeAction, nationalLifePending] = useActionState(verifyNationalLifeOnboardingAction, INITIAL_ONBOARDING_ACTION_STATE);
  const [calendarState, calendarAction, calendarPending] = useActionState(setCalendarOnboardingDecisionAction, INITIAL_ONBOARDING_ACTION_STATE);
  const [whatsappState, whatsappAction, whatsappPending] = useActionState(setWhatsAppOnboardingDecisionAction, INITIAL_ONBOARDING_ACTION_STATE);
  const [connectorState, setConnectorState] = useState<NationalLifeConnectorViewState | null>(null);
  const [whatsappConnectionOverride, setWhatsappConnectionOverride] = useState<boolean | null>(null);
  const whatsappConnected = whatsappConnectionOverride ?? integrations.whatsappConnected;

  const currentOnboarding = latestOnboarding(onboarding, [profileState, nationalLifeState, calendarState, whatsappState]);
  const currentStep = visibleStep(currentOnboarding.currentStep);
  const currentIndex = indexFor(currentStep);
  const [viewedStep, setViewedStep] = useState(currentStep);
  const previousCurrent = useRef(currentStep);

  useEffect(() => {
    if (previousCurrent.current === currentStep) return;
    previousCurrent.current = currentStep;
    setViewedStep(currentStep);
  }, [currentStep]);

  const viewedIndex = indexFor(viewedStep);
  const activeFeedback = viewedStep === "PROFILE"
    ? profileState
    : viewedStep === "NATIONAL_LIFE"
      ? nationalLifeState
      : viewedStep === "CALENDAR"
        ? calendarState
        : whatsappState;

  const returnToCurrent = () => setViewedStep(currentStep);

  return (
    <OnboardingMotion step={viewedStep}>
      <main className="onboarding-root">
        <a className="onboarding-skip-link" href="#onboarding-current-step">
          {copy("Ir para a etapa atual", "Skip to the current step")}
        </a>
        <OnboardingHeader currentIndex={currentIndex} />

        <div className="onboarding-frame">
          <StepNavigation currentStep={currentStep} viewedStep={viewedStep} onView={setViewedStep} />

          <div className="onboarding-workspace" id="onboarding-current-step" tabIndex={-1}>
            <div className="onboarding-screen" data-onboarding-screen key={viewedStep}>
              {viewedStep === "PROFILE" ? (
                <ProfileStep profile={profile} state={profileState} action={profileAction} pending={profilePending} isCurrent={viewedIndex === currentIndex} onReturn={returnToCurrent} />
              ) : null}
              {viewedStep === "NATIONAL_LIFE" ? (
                <KBotSetupStep integrationState={integrations.nationalLife} config={nationalLifeConfig} connectorState={connectorState} state={nationalLifeState} action={nationalLifeAction} pending={nationalLifePending} isCurrent={viewedIndex === currentIndex} onReturn={returnToCurrent} onConnectorStateChange={setConnectorState} />
              ) : null}
              {viewedStep === "CALENDAR" ? (
                <CalendarStep connected={integrations.calendarConnected} configured={calendarConfigured} result={calendarResult} state={calendarState} action={calendarAction} pending={calendarPending} isCurrent={viewedIndex === currentIndex} onReturn={returnToCurrent} />
              ) : null}
              {viewedStep === "WHATSAPP" ? (
                <WhatsAppStep connected={whatsappConnected} available={whatsapp.available} mode={whatsapp.mode} state={whatsappState} action={whatsappAction} pending={whatsappPending} isCurrent={viewedIndex === currentIndex} onReturn={returnToCurrent} onConnectionChange={setWhatsappConnectionOverride} />
              ) : null}
            </div>

            <KBotGuide
              step={viewedStep}
              profileName={profile.name}
              nationalLifeState={integrations.nationalLife}
              calendarConnected={integrations.calendarConnected}
              whatsappConnected={whatsappConnected}
              connectorState={connectorState}
              feedback={activeFeedback}
            />
          </div>
        </div>
      </main>
    </OnboardingMotion>
  );
}
