"use client";

import gsap from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NationalLifeConnectorViewState } from "@/app/agent/integrations/national-life/NationalLifeLocalConnectorCard";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { KBotAvatar } from "@/components/kbot/KBotAvatar";

const SOURCE_LABELS: Record<string, { pt: string; en: string }> = {
  NEW_BUSINESS: { pt: "Novos negócios", en: "New business" },
  RECENTLY_CLOSED: { pt: "Casos encerrados recentemente", en: "Recently closed cases" },
  INFORCE_CLIENTS: { pt: "Clientes e apólices em vigor", en: "In-force clients and policies" },
  PAID_COMMISSIONS: { pt: "Comissões pagas", en: "Paid commissions" },
  PROJECTED_COMMISSIONS: { pt: "Comissões projetadas", en: "Projected commissions" },
  CLIENT_INTELLIGENCE: { pt: "Inteligência de clientes", en: "Client intelligence" },
  CORRESPONDENCE: { pt: "Correspondências", en: "Correspondence" },
  COMMISSIONS_PAYMENT_PORTAL: { pt: "Pagamentos de comissão", en: "Commission payments" },
  COMMISSIONS_EARNING_REPORT: { pt: "Detalhamento de comissões", en: "Commission earning detail" },
  PAYABLE_GROSS_COMMISSIONS: { pt: "Comissões brutas a pagar", en: "Payable gross commissions" },
  PIP_PENDING: { pt: "Aumentos pendentes", en: "Pending increases" },
  TRANSFERS_EXCHANGES: { pt: "Transferências e trocas", en: "Transfers and exchanges" },
  LIFE_PENDING_LAPSE: { pt: "Apólices com risco de lapso", en: "Pending lapse policies" },
  PENDING_GROSS_COMMISSIONS: { pt: "Comissões brutas pendentes", en: "Pending gross commissions" },
  COMMISSIONS_OVERVIEW: { pt: "Resumo de comissões", en: "Commission overview" },
  COMMISSIONS_POLICY_HISTORY: { pt: "Histórico de comissões por apólice", en: "Policy commission history" },
  AGENT_DASHBOARD: { pt: "Resumo do agente", en: "Agent dashboard" },
  PREMIUM_REPORT_AGENCY: { pt: "Relatório de produção da agência", en: "Agency premium report" },
};

function sourceLabel(
  key: string | null | undefined,
  language: "PT" | "EN",
  fallback: string,
) {
  if (!key) return fallback;
  const known = SOURCE_LABELS[key];
  if (known) return language === "PT" ? known.pt : known.en;
  return key
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function stageCopy(
  state: NationalLifeConnectorViewState,
  copy: (portuguese: string, english: string) => string,
) {
  if (state.phase === "slow") {
    return {
      title: copy("Aguardando a National Life", "Waiting for National Life"),
      detail: copy("O que já foi concluído continua salvo.", "Everything completed so far remains saved."),
    };
  }

  switch (state.sync?.status) {
    case "NAVIGATING":
      return {
        title: copy("Abrindo a próxima área", "Opening the next area"),
        detail: copy("O K-Bot está acessando a fonte correta.", "K-Bot is opening the correct source."),
      };
    case "EXTRACTING":
      return {
        title: copy("Lendo suas informações", "Reading your information"),
        detail: copy("Os dados estão sendo conferidos antes de salvar.", "The data is being checked before it is saved."),
      };
    case "UPLOADING":
      return {
        title: copy("Salvando na Keepr One", "Saving to Keepr One"),
        detail: copy("Cada lote concluído fica protegido no sistema.", "Each completed batch is kept safely in the system."),
      };
    default:
      return {
        title: copy("Preparando a sincronização", "Preparing the sync"),
        detail: copy("Estou organizando a ordem das informações.", "I am organizing the order of your information."),
      };
  }
}

export function NationalLifeSyncModal({
  connectorState,
  skipAction,
  onSkip,
  skipPending,
  skipError,
}: {
  connectorState: NationalLifeConnectorViewState;
  skipAction: (payload: FormData) => void;
  onSkip: () => void;
  skipPending: boolean;
  skipError?: string | null;
}) {
  const { copy, language } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  const messages = useMemo(() => [
    copy("Ainda estamos carregando seus dados...", "We're still loading your data..."),
    copy("O carregamento pode demorar um pouco. Eu aviso quando terminar.", "This may take a little while. I'll let you know when it is done."),
    copy("Meu objetivo é manter tudo em um único lugar para você.", "My goal is to keep everything in one place for you."),
    copy("Cada área concluída já fica salva com segurança.", "Every completed area is already saved safely."),
  ], [copy]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    try {
      if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
      else if (!dialog.open) dialog.setAttribute("open", "");
    } catch {
      dialog.setAttribute("open", "");
    }
    dialog.focus();

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const context = gsap.context(() => {
      if (reducedMotion) return;
      gsap.fromTo(
        "[data-sync-modal-panel]",
        { y: 20, scale: 0.985, opacity: 0 },
        { y: 0, scale: 1, opacity: 1, duration: 0.42, ease: "power3.out", clearProps: "transform,opacity" },
      );
      gsap.fromTo(
        "[data-sync-modal-kbot]",
        { y: 10, scale: 0.88, opacity: 0 },
        { y: 0, scale: 1, opacity: 1, duration: 0.5, delay: 0.08, ease: "back.out(1.35)", clearProps: "transform,opacity" },
      );
    }, dialog);

    return () => {
      context.revert();
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % messages.length);
    }, 5_800);
    return () => window.clearInterval(timer);
  }, [messages.length]);

  useEffect(() => {
    const message = messageRef.current;
    if (!message) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reducedMotion) return;
    const tween = gsap.fromTo(
      message,
      { y: 5, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.3, ease: "power2.out", clearProps: "transform,opacity" },
    );
    return () => {
      tween.kill();
    };
  }, [messageIndex]);

  const progress = typeof connectorState.progress === "number"
    ? Math.round(Math.min(1, Math.max(0, connectorState.progress)) * 100)
    : null;
  const totalStages = connectorState.sync?.totalStages ?? null;
  const stageIndex = connectorState.sync?.stageIndex ?? null;
  const currentStage = totalStages && stageIndex !== null
    ? Math.min(totalStages, stageIndex + 1)
    : null;
  const stage = stageCopy(connectorState, copy);
  const area = sourceLabel(
    connectorState.sync?.stageKey,
    language,
    copy("National Life", "National Life"),
  );
  const progressDescription = [
    progress === null
      ? copy("Preparando o cálculo do progresso", "Preparing the progress estimate")
      : copy("{percent}% das áreas concluídas", "{percent}% of areas complete").replace("{percent}", String(progress)),
    currentStage && totalStages
      ? copy("área {current} de {total}", "area {current} of {total}")
        .replace("{current}", String(currentStage))
        .replace("{total}", String(totalStages))
      : null,
    stage.title,
  ].filter(Boolean).join(". ");

  return (
    <dialog
      ref={dialogRef}
      className="onboarding-sync-dialog"
      aria-labelledby="onboarding-sync-title"
      aria-describedby="onboarding-sync-description"
      onCancel={(event) => event.preventDefault()}
      tabIndex={-1}
    >
      <div className="onboarding-sync-modal" data-sync-modal-panel>
        <aside className="onboarding-sync-modal-kbot" aria-label={copy("Mensagem do K-Bot", "Message from K-Bot")}>
          <div data-sync-modal-kbot>
            <KBotAvatar state={connectorState.phase === "slow" ? "waiting" : "working"} size="lg" />
          </div>
          <div>
            <span>K-Bot</span>
            <strong>{copy("Estou cuidando disso para você.", "I'm taking care of this for you.")}</strong>
          </div>
        </aside>

        <section className="onboarding-sync-modal-content">
          <header>
            <div>
              <p>{copy("Sincronização em andamento", "Sync in progress")}</p>
              <h2 id="onboarding-sync-title">{copy("Seus dados estão sendo organizados.", "Your data is being organized.")}</h2>
            </div>
            <strong aria-hidden="true">
              {progress === null ? "…" : `${progress}%`}
            </strong>
          </header>

          <p id="onboarding-sync-description" className="onboarding-sync-modal-description">
            {copy(
              "Você pode aguardar aqui ou pular esta etapa. Tudo o que já foi salvo permanece seguro.",
              "You can wait here or skip this step. Everything already saved remains safe.",
            )}
          </p>

          <div className="onboarding-sync-current-stage">
            <div>
              <span>{copy("Agora", "Now")}</span>
              <strong>{stage.title}</strong>
              <small>{area} · {stage.detail}</small>
            </div>
            {currentStage && totalStages ? (
              <span>{copy("Área {current} de {total}", "Area {current} of {total}")
                .replace("{current}", String(currentStage))
                .replace("{total}", String(totalStages))}</span>
            ) : null}
          </div>

          <div
            className="onboarding-sync-progress"
            role="progressbar"
            aria-label={copy("Progresso da sincronização", "Sync progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress ?? undefined}
            aria-valuetext={progressDescription}
            data-state={progress === null ? "indeterminate" : "determinate"}
          >
            <span style={progress === null ? undefined : { width: `${progress}%` }} />
          </div>

          <div className="onboarding-sync-progress-meta">
            <strong>{progress === null
              ? copy("Calculando o progresso…", "Calculating progress…")
              : copy("{percent}% das áreas concluídas", "{percent}% of areas complete").replace("{percent}", String(progress))}</strong>
            <span>
              {connectorState.sync?.uploads
                ? copy("{count} lotes salvos", "{count} batches saved").replace("{count}", String(connectorState.sync.uploads))
                : copy("Preparando o primeiro salvamento", "Preparing the first save")}
            </span>
          </div>

          <div className="onboarding-sync-message">
            <span aria-hidden="true"><KBotAvatar state="working" size="sm" /></span>
            <p ref={messageRef} key={messageIndex}>{messages[messageIndex]}</p>
          </div>

          {skipError ? <p className="onboarding-sync-error" role="alert">{skipError}</p> : null}

          <footer>
            <p>{copy(
              "Ao pular, interrompemos esta sincronização. Você segue no onboarding e poderá conectar a National Life depois pelo painel.",
              "If you skip, we stop this sync. You will continue onboarding and can connect National Life later from your dashboard.",
            )}</p>
            <form action={skipAction} onSubmit={onSkip}>
              <button type="submit" disabled={skipPending} aria-busy={skipPending}>
                {skipPending
                  ? copy("Salvando sua escolha...", "Saving your choice...")
                  : copy("Pular por agora", "Skip for now")}
              </button>
            </form>
          </footer>
        </section>
      </div>
    </dialog>
  );
}
