"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  acknowledgeOnboardingWelcomeAction,
  completeOnboardingAction,
  markOnboardingModuleAction,
  saveOnboardingProfileAction,
  setCalendarOnboardingDecisionAction,
  setWhatsAppOnboardingDecisionAction,
  verifyNationalLifeOnboardingAction,
} from "@/app/onboarding/actions";
import {
  INITIAL_ONBOARDING_ACTION_STATE,
  type OnboardingActionState,
} from "@/app/onboarding/state";
import { Field, Input, Select } from "@/components/Field";
import { Logo } from "@/components/Logo";
import { ConnectOfficialWhatsapp } from "@/app/agent/mensagens/ConnectOfficialWhatsapp";
import { ConnectWhatsapp } from "@/app/agent/mensagens/ConnectWhatsapp";
import { NationalLifeLocalConnectorCard } from "@/app/agent/integrations/national-life/NationalLifeLocalConnectorCard";
import type {
  AgentOnboardingPageData,
  AgentOnboardingView,
  OnboardingModuleName,
} from "@/lib/agent-onboarding";
import type { PublicLocalConnectorConfig } from "@/lib/national-life/local-connector/config";
import type { WhatsappChannelMode } from "@/lib/messaging/channel-mode";
import { OnboardingIcon } from "./OnboardingIcon";
import { OnboardingMotion } from "./OnboardingMotion";
import {
  onboardingModulesFor,
} from "./module-catalog";

type OnboardingStep = AgentOnboardingView["currentStep"];

export type OnboardingExperienceProps = AgentOnboardingPageData & {
  onboarding: AgentOnboardingView;
  nationalLifeConfig: PublicLocalConnectorConfig;
  calendarConfigured: boolean;
  whatsapp: {
    available: boolean;
    mode: WhatsappChannelMode;
  };
};

const FLOW_STEPS = [
  { key: "WELCOME", label: "Boas-vindas", href: "#onboarding-welcome" },
  { key: "PROFILE", label: "Seus dados", href: "#onboarding-profile" },
  { key: "NATIONAL_LIFE", label: "National Life", href: "#onboarding-national-life" },
  { key: "CALENDAR", label: "Agenda", href: "#onboarding-calendar" },
  { key: "WHATSAPP", label: "WhatsApp", href: "#onboarding-whatsapp" },
  { key: "MODULES", label: "Tour", href: "#onboarding-tour" },
  { key: "REVIEW", label: "Revisão", href: "#onboarding-review" },
] as const satisfies readonly {
  key: Exclude<OnboardingStep, "COMPLETED">;
  label: string;
  href: string;
}[];

const TIME_ZONE_OPTIONS = [
  { value: "America/New_York", label: "Leste dos EUA — Eastern Time" },
  { value: "America/Chicago", label: "Centro dos EUA — Central Time" },
  { value: "America/Denver", label: "Montanhas — Mountain Time" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Oeste dos EUA — Pacific Time" },
  { value: "America/Anchorage", label: "Alasca" },
  { value: "Pacific/Honolulu", label: "Havaí" },
] as const;

function stepIndex(step: OnboardingStep): number {
  if (step === "COMPLETED") return FLOW_STEPS.length;
  return FLOW_STEPS.findIndex((item) => item.key === step);
}

function stepAnchor(step: OnboardingStep): string {
  if (step === "COMPLETED") return "#onboarding-review";
  return FLOW_STEPS.find((item) => item.key === step)?.href ?? "#onboarding-welcome";
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

function fieldError(state: OnboardingActionState, name: string): string | undefined {
  return state.fieldErrors?.[name];
}

function describedBy(id: string, error?: string, hasHint = false) {
  return [hasHint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;
}

function ActionFeedback({
  state,
  id,
}: {
  state: OnboardingActionState;
  id: string;
}) {
  if (!state.message) return null;
  return (
    <p
      id={id}
      role={state.status === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`onboarding-action-feedback ${state.status === "error" ? "is-error" : "is-success"}`}
    >
      {state.message}
    </p>
  );
}

function StepState({
  state,
}: {
  state: "complete" | "current" | "locked";
}) {
  const label =
    state === "complete"
      ? "Concluído"
      : state === "current"
        ? "Etapa atual"
        : "Aguardando etapa anterior";
  return (
    <span className={`onboarding-step-state is-${state}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function DirectionLink({
  href,
  children,
  direction = "left",
}: {
  href: string;
  children: React.ReactNode;
  direction?: "left" | "right";
}) {
  return (
    <a className="onboarding-secondary-action" href={href}>
      {direction === "left" ? (
        <OnboardingIcon name="arrow-left" className="size-4" />
      ) : null}
      {children}
      {direction === "right" ? (
        <OnboardingIcon name="arrow-right" className="size-4" />
      ) : null}
    </a>
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
      {pending ? pendingLabel : label}
      <OnboardingIcon name="arrow-right" className="size-4" />
    </button>
  );
}

function OnboardingTopbar({ currentStep }: { currentStep: OnboardingStep }) {
  const currentIndex = stepIndex(currentStep);
  const progress = Math.round((currentIndex / FLOW_STEPS.length) * 100);

  return (
    <header className="onboarding-topbar">
      <div className="onboarding-topbar-inner">
        <a href="#onboarding-welcome" aria-label="Keepr One — início do onboarding">
          <Logo size={30} className="text-white" />
        </a>
        <div className="onboarding-progress-copy">
          <span>{currentStep === "COMPLETED" ? "Configuração concluída" : "Configurando seu acesso"}</span>
          <strong>{progress}%</strong>
        </div>
        <div
          className="onboarding-progress-track"
          role="progressbar"
          aria-label="Progresso da configuração"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <nav aria-label="Etapas da configuração" className="onboarding-step-nav">
          <ol>
            {FLOW_STEPS.map((step, index) => {
              const available = index <= currentIndex;
              const current = step.key === currentStep;
              const content = (
                <>
                  <span aria-hidden="true">{index < currentIndex ? <OnboardingIcon name="check" className="size-3" /> : null}</span>
                  {step.label}
                </>
              );
              return (
                <li key={step.key}>
                  {available ? (
                    <a href={step.href} aria-current={current ? "step" : undefined}>
                      {content}
                    </a>
                  ) : (
                    <span aria-disabled="true">{content}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </header>
  );
}

function WelcomeHero({
  userName,
  currentStep,
  action,
  pending,
  state,
}: {
  userName: string;
  currentStep: OnboardingStep;
  action: (payload: FormData) => void;
  pending: boolean;
  state: OnboardingActionState;
}) {
  const isWelcome = currentStep === "WELCOME";
  const firstName = userName.trim().split(/\s+/)[0] || "agente";

  return (
    <section id="onboarding-welcome" className="onboarding-hero" aria-labelledby="onboarding-title">
      <div className="onboarding-hero-copy max-w-6xl">
        <p data-onboarding-reveal className="onboarding-hero-intro">
          Bem-vindo, {firstName}. Vamos preparar seu acesso.
        </p>
        <h1 data-onboarding-reveal id="onboarding-title">
          Sua operação inteira começa no lugar certo.
        </h1>
        <p data-onboarding-reveal className="onboarding-hero-description">
          Confirme seus dados, conecte as fontes que já usa e conheça cada área disponível no seu plano antes de entrar na operação.
        </p>
        <div data-onboarding-reveal className="onboarding-hero-actions">
          {isWelcome ? (
            <form action={action}>
              <button type="submit" className="onboarding-hero-primary" disabled={pending} aria-busy={pending}>
                {pending ? "Preparando configuração…" : "Começar configuração"}
                <OnboardingIcon name="arrow-right" className="size-4" />
              </button>
            </form>
          ) : (
            <a className="onboarding-hero-primary" href={stepAnchor(currentStep)}>
              Retomar de onde parei
              <OnboardingIcon name="arrow-right" className="size-4" />
            </a>
          )}
          <a className="onboarding-hero-secondary" href="#onboarding-path">
            Ver o percurso
          </a>
        </div>
        <ActionFeedback state={state} id="onboarding-welcome-feedback" />
      </div>

      <div data-onboarding-reveal className="onboarding-hero-art" aria-hidden="true">
        <Image
          src="/brand/keepr-one-logo-thumb.svg"
          alt=""
          width={280}
          height={280}
          priority
          className="onboarding-hero-mark"
        />
        <div className="onboarding-hero-orbit">
          {["Dados", "National Life", "Agenda", "Operação"].map((label, index) => (
            <span key={label} style={{ "--orbit-index": index } as React.CSSProperties}>
              {label}
            </span>
          ))}
        </div>
        <div className="onboarding-hero-window">
          <span />
          <span />
          <span />
        </div>
      </div>
    </section>
  );
}

function ModuleMarquee({ modules }: { modules: readonly OnboardingModuleName[] }) {
  const items = onboardingModulesFor(modules);
  return (
    <div id="onboarding-path" className="onboarding-marquee" aria-label="Áreas disponíveis no seu acesso">
      <div data-onboarding-marquee className="onboarding-marquee-track">
        {[...items, ...items].map((module, index) => (
          <span key={`${module.key}-${index}`} aria-hidden={index >= items.length ? "true" : undefined}>
            <OnboardingIcon name={module.key} className="size-4" />
            {module.shortTitle}
          </span>
        ))}
      </div>
    </div>
  );
}

type IntegrationKey = "national-life" | "calendar" | "whatsapp";

function IntegrationAccordion({
  nationalLifeState,
  calendarConnected,
  whatsappConnected,
}: {
  nationalLifeState: AgentOnboardingPageData["integrations"]["nationalLife"];
  calendarConnected: boolean;
  whatsappConnected: boolean;
}) {
  const [active, setActive] = useState<IntegrationKey>("national-life");
  const panels = [
    {
      key: "national-life" as const,
      title: "National Life",
      copy: "Obrigatória para validar a origem da carteira e liberar a operação.",
      status: nationalLifeState === "VERIFIED_SYNC" ? "Sincronização validada" : nationalLifeState === "CONNECTOR_PAIRED" ? "Computador conectado" : "Conexão pendente",
      href: "#onboarding-national-life",
    },
    {
      key: "calendar" as const,
      title: "Google Calendar",
      copy: "Opcional para trazer compromissos e reuniões para a Agenda Keepr One.",
      status: calendarConnected ? "Conectado" : "Você decide agora",
      href: "#onboarding-calendar",
    },
    {
      key: "whatsapp" as const,
      title: "WhatsApp",
      copy: "Opcional para concentrar conversas no contexto do relacionamento.",
      status: whatsappConnected ? "Conectado" : "Você decide agora",
      href: "#onboarding-whatsapp",
    },
  ];

  return (
    <div className="onboarding-integration-accordion" aria-label="Resumo das integrações">
      {panels.map((panel) => {
        const expanded = active === panel.key;
        return (
          <section key={panel.key} className={expanded ? "is-active" : ""}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`onboarding-integration-${panel.key}`}
              onClick={() => setActive(panel.key)}
            >
              <span>{panel.title}</span>
              <small>{panel.status}</small>
            </button>
            <div id={`onboarding-integration-${panel.key}`} hidden={!expanded}>
              <p>{panel.copy}</p>
              <a href={panel.href}>
                Abrir etapa
                <OnboardingIcon name="arrow-right" className="size-4" />
              </a>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ProfileCard({
  profile,
  currentStep,
  action,
  pending,
  state,
}: {
  profile: AgentOnboardingPageData["profile"];
  currentStep: OnboardingStep;
  action: (payload: FormData) => void;
  pending: boolean;
  state: OnboardingActionState;
}) {
  const currentIndex = stepIndex(currentStep);
  const ownIndex = stepIndex("PROFILE");
  const phase = currentIndex > ownIndex ? "complete" : currentIndex === ownIndex ? "current" : "locked";
  const enabled = phase === "current";
  const nameError = fieldError(state, "name");
  const phoneError = fieldError(state, "phone");
  const timeZoneError = fieldError(state, "timeZone");
  const npnError = fieldError(state, "npn");
  const knownTimeZone = TIME_ZONE_OPTIONS.some((option) => option.value === profile.timeZone);

  return (
    <article id="onboarding-profile" className="onboarding-bento-card onboarding-profile-card lg:col-span-4 lg:row-span-2" aria-labelledby="onboarding-profile-title" aria-disabled={phase === "locked" || undefined}>
      <header>
        <span className="onboarding-card-icon"><OnboardingIcon name="profile" /></span>
        <StepState state={phase} />
      </header>
      <h2 id="onboarding-profile-title">Confirme como sua operação identifica você.</h2>
      <p>Nome, telefone, fuso e NPN conectam agenda, produção e carteira ao perfil correto.</p>

      <form action={action} aria-describedby={state.message ? "onboarding-profile-feedback" : undefined}>
        <Field label="Nome completo" htmlFor="onboarding-name" error={nameError} required>
          <Input id="onboarding-name" name="name" autoComplete="name" maxLength={100} defaultValue={profile.name} required disabled={!enabled || pending} aria-invalid={Boolean(nameError)} aria-describedby={describedBy("onboarding-name", nameError)} />
        </Field>
        <Field label="Telefone" htmlFor="onboarding-phone" error={phoneError} required>
          <Input id="onboarding-phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={32} defaultValue={profile.phone} required disabled={!enabled || pending} aria-invalid={Boolean(phoneError)} aria-describedby={describedBy("onboarding-phone", phoneError)} />
        </Field>
        <Field label="Fuso horário" htmlFor="onboarding-time-zone" hint="Agenda e lembretes usam este horário." error={timeZoneError} required>
          <Select id="onboarding-time-zone" name="timeZone" defaultValue={profile.timeZone} required disabled={!enabled || pending} aria-invalid={Boolean(timeZoneError)} aria-describedby={describedBy("onboarding-time-zone", timeZoneError, true)}>
            {!knownTimeZone ? <option value={profile.timeZone}>{profile.timeZone}</option> : null}
            {TIME_ZONE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>
        <Field label="NPN" htmlFor="onboarding-npn" hint="Informe de 4 a 20 números do identificador associado à sua produção." error={npnError} required>
          <Input id="onboarding-npn" name="npn" inputMode="numeric" autoComplete="off" minLength={4} maxLength={20} pattern="[0-9]{4,20}" defaultValue={profile.npn} required disabled={!enabled || pending} aria-invalid={Boolean(npnError)} aria-describedby={describedBy("onboarding-npn", npnError, true)} />
        </Field>

        <ActionFeedback state={state} id="onboarding-profile-feedback" />
        {enabled ? (
          <div className="onboarding-card-actions">
            <DirectionLink href="#onboarding-welcome">Voltar</DirectionLink>
            <PrimarySubmit label="Salvar e continuar" pendingLabel="Salvando dados…" pending={pending} />
          </div>
        ) : null}
      </form>
    </article>
  );
}

function NationalLifeCard({
  currentStep,
  integrationState,
  config,
  action,
  pending,
  state,
}: {
  currentStep: OnboardingStep;
  integrationState: AgentOnboardingPageData["integrations"]["nationalLife"];
  config: PublicLocalConnectorConfig;
  action: (payload: FormData) => void;
  pending: boolean;
  state: OnboardingActionState;
}) {
  const currentIndex = stepIndex(currentStep);
  const ownIndex = stepIndex("NATIONAL_LIFE");
  const phase = currentIndex > ownIndex ? "complete" : currentIndex === ownIndex ? "current" : "locked";
  const enabled = phase === "current";

  return (
    <article id="onboarding-national-life" className="onboarding-bento-card onboarding-national-life-card lg:col-span-8" aria-labelledby="onboarding-national-life-title" aria-disabled={phase === "locked" || undefined}>
      <div className="onboarding-card-heading-row">
        <div>
          <span className="onboarding-card-icon"><OnboardingIcon name="national-life" /></span>
          <h2 id="onboarding-national-life-title">Valide sua origem National Life.</h2>
          <p>Esta conexão é obrigatória. A Keepr One só avança depois de uma sincronização completa e verificável.</p>
        </div>
        <StepState state={phase} />
      </div>

      <div className="onboarding-integration-status" data-status={integrationState.toLowerCase()}>
        <strong>{integrationState === "VERIFIED_SYNC" ? "Sincronização validada" : integrationState === "CONNECTOR_PAIRED" ? "Computador conectado" : "Conexão ainda não iniciada"}</strong>
        <span>{integrationState === "VERIFIED_SYNC" ? "A origem foi comprovada e esta etapa está concluída." : integrationState === "CONNECTOR_PAIRED" ? "Faça uma sincronização completa e valide o resultado abaixo." : "Conecte pelo fluxo oficial disponível neste ambiente."}</span>
      </div>

      {enabled && integrationState !== "VERIFIED_SYNC" ? (
        config.enabled ? (
          <div className="onboarding-embedded-connector">
            <NationalLifeLocalConnectorCard extensionId={config.extensionId} storeUrl={config.storeUrl} installMode={config.installMode} baseUrl={config.baseUrl} />
          </div>
        ) : (
          <div className="onboarding-unavailable-note" role="status">
            <strong>A conexão ainda não foi liberada neste ambiente.</strong>
            <p>A equipe Keepr One precisa habilitar o conector National Life antes de você concluir esta etapa. Nenhum endereço alternativo será solicitado.</p>
          </div>
        )
      ) : null}

      <ActionFeedback state={state} id="onboarding-national-life-feedback" />
      {enabled ? (
        <form action={action} className="onboarding-card-actions" aria-describedby={state.message ? "onboarding-national-life-feedback" : undefined}>
          <DirectionLink href="#onboarding-profile">Voltar</DirectionLink>
          <PrimarySubmit label="Validar sincronização" pendingLabel="Validando origem…" pending={pending} disabled={!config.enabled} />
        </form>
      ) : null}
    </article>
  );
}

function CalendarCard({
  currentStep,
  connected,
  configured,
  action,
  pending,
  state,
}: {
  currentStep: OnboardingStep;
  connected: boolean;
  configured: boolean;
  action: (payload: FormData) => void;
  pending: boolean;
  state: OnboardingActionState;
}) {
  const currentIndex = stepIndex(currentStep);
  const ownIndex = stepIndex("CALENDAR");
  const phase = currentIndex > ownIndex ? "complete" : currentIndex === ownIndex ? "current" : "locked";
  const enabled = phase === "current";

  return (
    <article id="onboarding-calendar" className="onboarding-bento-card onboarding-calendar-card lg:col-span-4" aria-labelledby="onboarding-calendar-title" aria-disabled={phase === "locked" || undefined}>
      <header>
        <span className="onboarding-card-icon"><OnboardingIcon name="google-calendar" /></span>
        <StepState state={phase} />
      </header>
      <h2 id="onboarding-calendar-title">Leve o Google Calendar para sua Agenda.</h2>
      <p>A integração disponível hoje é exclusivamente com Google Calendar. Apple Calendar e iCal ainda não fazem parte deste fluxo.</p>

      {connected ? <p className="onboarding-connected-copy"><OnboardingIcon name="check" /> Google Calendar conectado</p> : null}
      {!configured && enabled ? <p className="onboarding-unavailable-copy">A autorização Google ainda não está configurada neste ambiente. Você pode seguir e conectar depois.</p> : null}

      <ActionFeedback state={state} id="onboarding-calendar-feedback" />
      {enabled ? (
        <div className="onboarding-option-actions">
          {configured && !connected ? (
            <Link className="onboarding-primary-action" href="/api/agent/integrations/google-calendar/authorize?returnTo=/onboarding">
              Conectar Google Calendar
              <OnboardingIcon name="arrow-right" className="size-4" />
            </Link>
          ) : null}
          {connected ? (
            <form action={action}>
              <input type="hidden" name="decision" value="CONNECTED" />
              <PrimarySubmit label="Validar e continuar" pendingLabel="Validando agenda…" pending={pending} />
            </form>
          ) : null}
          <form action={action}>
            <input type="hidden" name="decision" value="SKIPPED" />
            <button type="submit" className="onboarding-text-action" disabled={pending}>Configurar depois</button>
          </form>
        </div>
      ) : null}
    </article>
  );
}

function WhatsappCard({
  currentStep,
  connected,
  available,
  mode,
  action,
  pending,
  state,
}: {
  currentStep: OnboardingStep;
  connected: boolean;
  available: boolean;
  mode: WhatsappChannelMode;
  action: (payload: FormData) => void;
  pending: boolean;
  state: OnboardingActionState;
}) {
  const currentIndex = stepIndex(currentStep);
  const ownIndex = stepIndex("WHATSAPP");
  const phase = currentIndex > ownIndex ? "complete" : currentIndex === ownIndex ? "current" : "locked";
  const enabled = phase === "current";

  return (
    <article id="onboarding-whatsapp" className="onboarding-bento-card onboarding-whatsapp-card lg:col-span-4" aria-labelledby="onboarding-whatsapp-title" aria-disabled={phase === "locked" || undefined}>
      <header>
        <span className="onboarding-card-icon"><OnboardingIcon name="whatsapp" /></span>
        <StepState state={phase} />
      </header>
      <h2 id="onboarding-whatsapp-title">Decida quando trazer suas conversas.</h2>
      <p>O WhatsApp é opcional. Se a infraestrutura estiver pronta, você pode conectar agora; caso contrário, a escolha fica registrada para depois.</p>

      {connected ? <p className="onboarding-connected-copy"><OnboardingIcon name="check" /> WhatsApp conectado e verificado</p> : null}
      {!available && enabled ? <p className="onboarding-unavailable-copy">A infraestrutura de mensagens ainda não está liberada para esta conta. Nenhum botão de conexão indisponível será exibido.</p> : null}

      {available && enabled && !connected ? (
        <details className="onboarding-inline-setup">
          <summary>Configurar WhatsApp agora</summary>
          <div>{mode === "META_CLOUD" ? <ConnectOfficialWhatsapp /> : <ConnectWhatsapp />}</div>
        </details>
      ) : null}

      <ActionFeedback state={state} id="onboarding-whatsapp-feedback" />
      {enabled ? (
        <div className="onboarding-option-actions">
          {connected ? (
            <form action={action}>
              <input type="hidden" name="decision" value="CONNECTED" />
              <PrimarySubmit label="Validar e continuar" pendingLabel="Validando WhatsApp…" pending={pending} />
            </form>
          ) : null}
          <form action={action}>
            <input type="hidden" name="decision" value="SKIPPED" />
            <button type="submit" className="onboarding-text-action" disabled={pending}>Configurar depois</button>
          </form>
        </div>
      ) : null}
    </article>
  );
}

function SetupBento({
  data,
  currentStep,
  nationalLifeConfig,
  calendarConfigured,
  whatsapp,
  profileAction,
  profilePending,
  profileState,
  nationalLifeAction,
  nationalLifePending,
  nationalLifeState,
  calendarAction,
  calendarPending,
  calendarState,
  whatsappAction,
  whatsappPending,
  whatsappState,
}: {
  data: Pick<AgentOnboardingPageData, "profile" | "integrations">;
  currentStep: OnboardingStep;
  nationalLifeConfig: PublicLocalConnectorConfig;
  calendarConfigured: boolean;
  whatsapp: OnboardingExperienceProps["whatsapp"];
  profileAction: (payload: FormData) => void;
  profilePending: boolean;
  profileState: OnboardingActionState;
  nationalLifeAction: (payload: FormData) => void;
  nationalLifePending: boolean;
  nationalLifeState: OnboardingActionState;
  calendarAction: (payload: FormData) => void;
  calendarPending: boolean;
  calendarState: OnboardingActionState;
  whatsappAction: (payload: FormData) => void;
  whatsappPending: boolean;
  whatsappState: OnboardingActionState;
}) {
  return (
    <section className="onboarding-setup" aria-labelledby="onboarding-setup-title">
      <div className="onboarding-section-heading">
        <h2 id="onboarding-setup-title">Quatro decisões deixam a base pronta.</h2>
        <p>Os dados pessoais identificam você. As integrações entram apenas quando a origem e o estado podem ser comprovados.</p>
      </div>

      <IntegrationAccordion nationalLifeState={data.integrations.nationalLife} calendarConnected={data.integrations.calendarConnected} whatsappConnected={data.integrations.whatsappConnected} />

      <div className="onboarding-setup-grid grid grid-flow-dense grid-cols-1 gap-0 lg:grid-cols-12">
        <ProfileCard profile={data.profile} currentStep={currentStep} action={profileAction} pending={profilePending} state={profileState} />
        <NationalLifeCard currentStep={currentStep} integrationState={data.integrations.nationalLife} config={nationalLifeConfig} action={nationalLifeAction} pending={nationalLifePending} state={nationalLifeState} />
        <CalendarCard currentStep={currentStep} connected={data.integrations.calendarConnected} configured={calendarConfigured} action={calendarAction} pending={calendarPending} state={calendarState} />
        <WhatsappCard currentStep={currentStep} connected={data.integrations.whatsappConnected} available={whatsapp.available} mode={whatsapp.mode} action={whatsappAction} pending={whatsappPending} state={whatsappState} />
      </div>
    </section>
  );
}

function ModuleTour({
  onboarding,
  action,
  pending,
  state,
}: {
  onboarding: AgentOnboardingView;
  action: (payload: FormData) => void;
  pending: boolean;
  state: OnboardingActionState;
}) {
  const modules = useMemo(
    () => onboardingModulesFor(onboarding.requiredModules),
    [onboarding.requiredModules],
  );
  const firstPending = onboarding.pendingModules[0];
  const initialIndex = Math.max(0, modules.findIndex((module) => module.key === firstPending));
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeModule = modules[activeIndex] ?? modules[0];
  const completed = activeModule ? onboarding.completedModules.includes(activeModule.key) : false;
  const enabled = onboarding.currentStep === "MODULES";
  const handledUpdate = useRef<string | null>(null);
  const actionOnboarding = state.onboarding;

  useEffect(() => {
    if (
      state.status !== "success"
      || !actionOnboarding
      || handledUpdate.current === actionOnboarding.updatedAt
    ) {
      return;
    }
    handledUpdate.current = actionOnboarding.updatedAt;
    const nextPending = actionOnboarding.pendingModules[0];
    const nextIndex = modules.findIndex((module) => module.key === nextPending);
    if (nextIndex < 0) return;

    const frame = window.requestAnimationFrame(() => setActiveIndex(nextIndex));
    return () => window.cancelAnimationFrame(frame);
  }, [actionOnboarding, modules, state.status]);

  if (!activeModule) return null;

  function move(direction: -1 | 1) {
    setActiveIndex((current) => (current + direction + modules.length) % modules.length);
  }

  return (
    <section id="onboarding-tour" data-onboarding-tour className="onboarding-tour" aria-labelledby="onboarding-tour-title">
      <div data-onboarding-tour-heading className="onboarding-tour-heading">
        <h2 id="onboarding-tour-title">Conheça a casa antes de começar o dia.</h2>
        <p>Seu tour mostra somente os módulos liberados para o seu plano. Cada área precisa ser revisada antes da etapa final.</p>
        <div className="onboarding-tour-progress" aria-label={`${onboarding.completedModules.length} de ${modules.length} módulos revisados`}>
          <span><strong>{onboarding.completedModules.length}</strong> de {modules.length} revisados</span>
          <span><i style={{ width: `${Math.round((onboarding.completedModules.length / modules.length) * 100)}%` }} /></span>
        </div>
      </div>

      <div className="onboarding-tour-stage">
        <div className="onboarding-carousel-controls">
          <span>{activeIndex + 1} de {modules.length}</span>
          <div>
            <button type="button" onClick={() => move(-1)} aria-label="Ver módulo anterior"><OnboardingIcon name="arrow-left" /></button>
            <button type="button" onClick={() => move(1)} aria-label="Ver próximo módulo"><OnboardingIcon name="arrow-right" /></button>
          </div>
        </div>

        <div className="onboarding-module-carousel" data-accent={activeModule.accent}>
          <div className="onboarding-module-ghost is-back" aria-hidden="true" />
          <div className="onboarding-module-ghost is-front" aria-hidden="true" />
          <article key={activeModule.key} aria-live="polite">
            <div className="onboarding-module-icon"><OnboardingIcon name={activeModule.key} /></div>
            <div className="onboarding-module-copy">
              <h3>{activeModule.title}</h3>
              <p>{activeModule.description}</p>
              <blockquote>{activeModule.outcome}</blockquote>
            </div>
            <div className="onboarding-module-preview" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          </article>
        </div>

        <ActionFeedback state={state} id="onboarding-module-feedback" />
        <div className="onboarding-tour-actions">
          <DirectionLink href="#onboarding-whatsapp">Voltar às conexões</DirectionLink>
          {enabled && !completed ? (
            <form action={action} aria-describedby={state.message ? "onboarding-module-feedback" : undefined}>
              <input type="hidden" name="module" value={activeModule.key} />
              <PrimarySubmit label="Marcar como revisado" pendingLabel="Registrando módulo…" pending={pending} />
            </form>
          ) : completed ? (
            <span className="onboarding-reviewed-state"><OnboardingIcon name="check" /> Módulo revisado</span>
          ) : (
            <span className="onboarding-locked-state">Conclua as conexões para iniciar o tour.</span>
          )}
        </div>
      </div>
    </section>
  );
}

function ReviewSection({
  onboarding,
  integrations,
  action,
  pending,
  state,
}: {
  onboarding: AgentOnboardingView;
  integrations: AgentOnboardingPageData["integrations"];
  action: (payload: FormData) => void;
  pending: boolean;
  state: OnboardingActionState;
}) {
  const enabled = onboarding.currentStep === "REVIEW";
  const checks = [
    { title: "Dados do perfil", detail: onboarding.profileCompletedAt ? "Identidade profissional confirmada" : "Ainda pendente", complete: Boolean(onboarding.profileCompletedAt) },
    { title: "National Life", detail: integrations.nationalLife === "VERIFIED_SYNC" ? "Sincronização completa validada" : "Ainda pendente", complete: Boolean(onboarding.nationalLifeVerifiedAt) },
    { title: "Google Calendar", detail: onboarding.calendarDecision === "CONNECTED" ? "Conexão validada" : onboarding.calendarDecision === "SKIPPED" ? "Escolhido para configurar depois" : "Decisão pendente", complete: Boolean(onboarding.calendarDecision) },
    { title: "WhatsApp", detail: onboarding.whatsappDecision === "CONNECTED" ? "Conexão validada" : onboarding.whatsappDecision === "SKIPPED" ? "Escolhido para configurar depois" : "Decisão pendente", complete: Boolean(onboarding.whatsappDecision) },
    { title: "Tour dos módulos", detail: `${onboarding.completedModules.length} de ${onboarding.requiredModules.length} áreas revisadas`, complete: onboarding.pendingModules.length === 0 },
  ];

  return (
    <section id="onboarding-review" className="onboarding-review" aria-labelledby="onboarding-review-title">
      <div className="onboarding-review-copy">
        <h2 id="onboarding-review-title">Revise a base. Depois, a operação é sua.</h2>
        <p>Nada é marcado por aparência. Cada conclusão abaixo vem do cadastro, da conexão validada ou de uma decisão que você tomou.</p>
        <ActionFeedback state={state} id="onboarding-review-feedback" />
        <div className="onboarding-review-actions">
          <DirectionLink href="#onboarding-tour">Voltar ao tour</DirectionLink>
          {enabled ? (
            <form action={action} aria-describedby={state.message ? "onboarding-review-feedback" : undefined}>
              <PrimarySubmit label="Concluir e entrar na plataforma" pendingLabel="Concluindo configuração…" pending={pending} disabled={checks.some((check) => !check.complete)} />
            </form>
          ) : (
            <span className="onboarding-locked-state">Conclua todas as etapas para liberar o acesso.</span>
          )}
        </div>
      </div>
      <div className="onboarding-review-stack">
        {checks.map((check) => (
          <article key={check.title} data-onboarding-stack-card>
            <span className={check.complete ? "is-complete" : "is-pending"}>
              {check.complete ? <OnboardingIcon name="check" /> : null}
            </span>
            <div>
              <h3>{check.title}</h3>
              <p>{check.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function OnboardingExperience({
  onboarding,
  profile,
  integrations,
  nationalLifeConfig,
  calendarConfigured,
  whatsapp,
}: OnboardingExperienceProps) {
  const [welcomeState, welcomeAction, welcomePending] = useActionState(acknowledgeOnboardingWelcomeAction, INITIAL_ONBOARDING_ACTION_STATE);
  const [profileState, profileAction, profilePending] = useActionState(saveOnboardingProfileAction, INITIAL_ONBOARDING_ACTION_STATE);
  const [nationalLifeState, nationalLifeAction, nationalLifePending] = useActionState(verifyNationalLifeOnboardingAction, INITIAL_ONBOARDING_ACTION_STATE);
  const [calendarState, calendarAction, calendarPending] = useActionState(setCalendarOnboardingDecisionAction, INITIAL_ONBOARDING_ACTION_STATE);
  const [whatsappState, whatsappAction, whatsappPending] = useActionState(setWhatsAppOnboardingDecisionAction, INITIAL_ONBOARDING_ACTION_STATE);
  const [moduleState, moduleAction, modulePending] = useActionState(markOnboardingModuleAction, INITIAL_ONBOARDING_ACTION_STATE);
  const [completeState, completeAction, completePending] = useActionState(completeOnboardingAction, INITIAL_ONBOARDING_ACTION_STATE);

  const currentOnboarding = latestOnboarding(onboarding, [welcomeState, profileState, nationalLifeState, calendarState, whatsappState, moduleState, completeState]);
  const initialStep = useRef(currentOnboarding.currentStep);
  const lastFocusedStep = useRef(currentOnboarding.currentStep);

  useEffect(() => {
    if (
      currentOnboarding.currentStep === initialStep.current
      && lastFocusedStep.current === initialStep.current
    ) {
      return;
    }
    if (lastFocusedStep.current === currentOnboarding.currentStep) return;
    lastFocusedStep.current = currentOnboarding.currentStep;

    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        stepAnchor(currentOnboarding.currentStep),
      );
      if (!target) return;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      target.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [currentOnboarding.currentStep]);

  return (
    <OnboardingMotion>
      <main className="onboarding-root w-full max-w-full overflow-x-hidden">
        <a className="onboarding-skip-link" href="#onboarding-welcome">Ir para o conteúdo principal</a>
        <OnboardingTopbar currentStep={currentOnboarding.currentStep} />
        <WelcomeHero userName={profile.name} currentStep={currentOnboarding.currentStep} action={welcomeAction} pending={welcomePending} state={welcomeState} />
        <ModuleMarquee modules={currentOnboarding.requiredModules} />
        <SetupBento
          data={{ profile, integrations }}
          currentStep={currentOnboarding.currentStep}
          nationalLifeConfig={nationalLifeConfig}
          calendarConfigured={calendarConfigured}
          whatsapp={whatsapp}
          profileAction={profileAction}
          profilePending={profilePending}
          profileState={profileState}
          nationalLifeAction={nationalLifeAction}
          nationalLifePending={nationalLifePending}
          nationalLifeState={nationalLifeState}
          calendarAction={calendarAction}
          calendarPending={calendarPending}
          calendarState={calendarState}
          whatsappAction={whatsappAction}
          whatsappPending={whatsappPending}
          whatsappState={whatsappState}
        />
        <ModuleTour onboarding={currentOnboarding} action={moduleAction} pending={modulePending} state={moduleState} />
        <ReviewSection onboarding={currentOnboarding} integrations={integrations} action={completeAction} pending={completePending} state={completeState} />
        <footer className="onboarding-footer">
          <Logo size={26} className="text-white" />
          <p>Seu progresso fica salvo para você continuar com segurança.</p>
        </footer>
      </main>
    </OnboardingMotion>
  );
}
