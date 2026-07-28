"use client";

import { Fragment, memo, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Logo } from "@/components/Logo";
import { NavIcon, type NavIconName } from "@/components/NavIcon";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const PREVIEW_VIEWS = [
  {
    id: "today",
    label: "Hoje",
    pageTitle: "Hoje",
    icon: "grid",
    group: "Operação",
  },
  {
    id: "crm",
    label: "CRM",
    pageTitle: "CRM · Oportunidades",
    icon: "layers",
    group: "Operação",
  },
  {
    id: "policies",
    label: "Apólices",
    pageTitle: "Apólices",
    icon: "document",
    group: "Carteira",
  },
  {
    id: "commissions",
    label: "Comissões",
    pageTitle: "Extrato de comissões",
    icon: "money",
    group: "Carteira",
  },
  {
    id: "team",
    label: "Equipe",
    pageTitle: "Minha equipe",
    icon: "hierarchy",
    group: "Gestão",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  pageTitle: string;
  icon: NavIconName;
  group: string;
}>;

type PreviewViewId = (typeof PREVIEW_VIEWS)[number]["id"];
type CollectionViewId = Exclude<PreviewViewId, "today" | "crm">;

type CollectionScreenData = {
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  metrics: ReadonlyArray<{
    label: string;
    value: string;
    tone?: "positive" | "warning" | "risk";
  }>;
  columns: readonly [string, string, string];
  rows: ReadonlyArray<{
    primary: string;
    secondary: string;
    status: string;
    tone?: "positive" | "warning" | "risk";
  }>;
  insight: {
    eyebrow: string;
    value: string;
    title: string;
    body: string;
    progress: number;
    progressLabel: string;
  };
};

const COLLECTION_SCREENS: Record<CollectionViewId, CollectionScreenData> = {
  policies: {
    eyebrow: "Cobertura sob controle",
    title: "Risco e revisão aparecem antes.",
    description:
      "Vigência, prêmio e sinais de atenção organizados para proteger a carteira.",
    action: "Nova apólice",
    metrics: [
      { label: "Apólices ativas", value: "112", tone: "positive" },
      { label: "Em risco", value: "02", tone: "risk" },
      { label: "Revisões", value: "04", tone: "warning" },
    ],
    columns: ["Apólice", "Prêmio", "Status"],
    rows: [
      {
        primary: "Vida inteira · A. Ribeiro",
        secondary: "$1.280 / ano",
        status: "Ativa",
        tone: "positive",
      },
      {
        primary: "Term Life · C. Rocha",
        secondary: "$840 / ano",
        status: "Revisar",
        tone: "warning",
      },
      {
        primary: "IUL · R. Martins",
        secondary: "$2.400 / ano",
        status: "Em risco",
        tone: "risk",
      },
    ],
    insight: {
      eyebrow: "Proteção",
      value: "98%",
      title: "Cobertura ativa na carteira.",
      body: "Duas apólices pedem ação preventiva antes do próximo ciclo.",
      progress: 98,
      progressLabel: "98% da carteira protegida",
    },
  },
  commissions: {
    eyebrow: "Extrato de comissões",
    title: "Do esperado ao pago, sem surpresa.",
    description:
      "Conciliação, origem e status de cada movimento em um extrato legível.",
    action: "Exportar extrato",
    metrics: [
      { label: "Conciliado", value: "$18.7k", tone: "positive" },
      { label: "Esperado", value: "$12.4k", tone: "warning" },
      { label: "Chargebacks", value: "$640", tone: "risk" },
    ],
    columns: ["Origem", "Valor", "Status"],
    rows: [
      {
        primary: "Policy #KPR-2841",
        secondary: "$8.420",
        status: "Pago",
        tone: "positive",
      },
      {
        primary: "Override · Equipe Norte",
        secondary: "$6.980",
        status: "Conciliando",
        tone: "warning",
      },
      {
        primary: "Policy #KPR-2796",
        secondary: "$4.260",
        status: "Esperado",
      },
    ],
    insight: {
      eyebrow: "Julho",
      value: "+18%",
      title: "Produção acima do período anterior.",
      body: "O avanço é explicado por cinco apólices e dois overrides de equipe.",
      progress: 76,
      progressLabel: "76% do período conciliado",
    },
  },
  team: {
    eyebrow: "Gestão da operação",
    title: "Sua equipe, com produção visível.",
    description:
      "Acompanhe atividade, carteira e resultado sem perder o ritmo da agência.",
    action: "Ver hierarquia",
    metrics: [
      { label: "Agentes ativos", value: "08", tone: "positive" },
      { label: "Em produção", value: "07" },
      { label: "Meta do ciclo", value: "87%", tone: "warning" },
    ],
    columns: ["Agente", "Produção", "Status"],
    rows: [
      {
        primary: "Marina Costa",
        secondary: "$14.820",
        status: "Acima da meta",
        tone: "positive",
      },
      {
        primary: "Lucas Souza",
        secondary: "$11.460",
        status: "No ritmo",
      },
      {
        primary: "Ana Ribeiro",
        secondary: "$9.780",
        status: "Acompanhar",
        tone: "warning",
      },
    ],
    insight: {
      eyebrow: "Performance",
      value: "$42.8k",
      title: "Produção conectada à equipe.",
      body: "A hierarquia mostra onde apoiar, reconhecer e acelerar cada agente.",
      progress: 87,
      progressLabel: "87% da meta do ciclo",
    },
  },
};

function TodayScreen() {
  return (
    <div className="landing-product-screen-inner">
      <div className="landing-product-grid landing-product-today-grid">
        <section
          className="landing-commission-panel"
          data-product-screen-content
        >
          <div className="landing-product-greeting landing-product-greeting-inverse">
            <div>
              <span>Bom dia, agente.</span>
              <h2>Estas são suas comissões neste mês.</h2>
            </div>
            <span className="landing-product-link">Ver extrato ↗</span>
          </div>

          <div className="landing-commission-value">
            <strong>$18,760</strong>
            <span>
              <b>↑ 24.8%</b>
              comparado ao mês anterior
            </span>
          </div>

          <div className="landing-chart">
            <div className="landing-chart-header">
              <span>Comissões registradas · 6 meses</span>
              <span>Período 2026-07</span>
            </div>
            <svg
              viewBox="0 0 600 170"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="landing-preview-chart-fill"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor="#65e497"
                    stopOpacity=".36"
                  />
                  <stop
                    offset="100%"
                    stopColor="#65e497"
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>
              <path
                d="M0 148 C78 148 116 148 172 148 C223 148 238 101 291 92 C352 83 370 40 432 38 C493 36 520 73 600 58 L600 170 L0 170 Z"
                fill="url(#landing-preview-chart-fill)"
              />
              <path
                data-product-chart-line
                d="M0 148 C78 148 116 148 172 148 C223 148 238 101 291 92 C352 83 370 40 432 38 C493 36 520 73 600 58"
                fill="none"
                stroke="#65e497"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx="432" cy="38" r="5" fill="#f7f8f5" />
            </svg>
            <div className="landing-chart-months" aria-hidden="true">
              <span>FEV</span>
              <span>MAR</span>
              <span>ABR</span>
              <span>MAI</span>
              <span>JUN</span>
              <span>JUL</span>
            </div>
          </div>

          <div className="landing-commission-breakdown">
            <span>
              <small>Esperada</small>
              <b>$22,480</b>
            </span>
            <span>
              <small>Paga</small>
              <b className="is-green">$18,760</b>
            </span>
            <span>
              <small>Chargebacks</small>
              <b>$640</b>
            </span>
          </div>
        </section>

        <aside
          className="landing-priority-panel"
          data-product-screen-content
        >
          <div className="landing-priority-heading">
            <div>
              <span>Sua fila</span>
              <h3>Prioridades de hoje</h3>
            </div>
            <b>10</b>
          </div>
          <p>
            Comece pelo que pode mover resultado ou proteger sua carteira.
          </p>
          <div className="landing-priority-list">
            {[
              ["4", "Retornos pendentes"],
              ["3", "Pendências abertas"],
              ["2", "Apólices em risco"],
              ["1", "Revisões anuais"],
            ].map(([count, label]) => (
              <span
                key={label}
                className={count === "2" ? "is-risk" : undefined}
              >
                <b>{count}</b>
                {label}
                <i>→</i>
              </span>
            ))}
          </div>
          <span className="landing-priority-button">Abrir fila completa</span>
        </aside>
      </div>
    </div>
  );
}

const CRM_PREVIEW_TABS = [
  {
    index: "01",
    eyebrow: "Pipeline",
    label: "Oportunidades",
    detail: "Do contato à emissão",
  },
  {
    index: "02",
    eyebrow: "Relacionamentos",
    label: "Clientes",
    detail: "Dados e histórico",
  },
  {
    index: "03",
    eyebrow: "Próximas ações",
    label: "Atividades",
    detail: "Retornos e pendências",
  },
] as const;

const CRM_PREVIEW_STAGES = [
  "Novo atendimento",
  "Diagnóstico",
  "Proposta",
  "Aplicação",
  "Análise",
  "Emissão",
  "Relacionamento",
] as const;

const CRM_PREVIEW_ROWS = [
  {
    initials: "AR",
    client: "Ana Ribeiro",
    owner: "Agente Base · atualizado hoje",
    product: "Term · Proteção",
    coverage: "$750,000",
    budget: "$220/mês",
    status: "Em análise",
    tone: "warning",
  },
  {
    initials: "LS",
    client: "Lucas Souza",
    owner: "Agente Base · atualizado ontem",
    product: "IUL · Legado",
    coverage: "$1,000,000",
    budget: "$350/mês",
    status: "Aplicação",
    tone: "neutral",
  },
  {
    initials: "MC",
    client: "Marina Costa",
    owner: "Agente Base · atualizado 25 jul",
    product: "Term · Aposentadoria",
    coverage: "$500,000",
    budget: "$180/mês",
    status: "Emitida",
    tone: "positive",
  },
] as const;

function CrmFlowGroup({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="landing-crm-flow-group" aria-hidden={hidden || undefined}>
      {CRM_PREVIEW_STAGES.map((stage) => (
        <span key={stage}>
          {stage}
          <i />
        </span>
      ))}
    </div>
  );
}

function CrmScreen() {
  return (
    <div className="landing-product-screen-inner landing-crm-screen">
      <nav
        className="landing-crm-navigation"
        aria-label="Visões do CRM na demonstração"
        data-product-screen-content
      >
        <div className="landing-crm-navigation-intro">
          <span>CRM</span>
          <p>Do primeiro contato ao relacionamento.</p>
        </div>

        <ol>
          {CRM_PREVIEW_TABS.map((tab, index) => (
            <li className={index === 0 ? "is-active" : undefined} key={tab.label}>
              <span>{tab.index}</span>
              <div>
                <small>{tab.eyebrow}</small>
                <strong>{tab.label}</strong>
                <em>{tab.detail}</em>
              </div>
              <i aria-hidden="true">→</i>
            </li>
          ))}
        </ol>
      </nav>

      <section className="landing-crm-hero" data-product-screen-content>
        <div className="landing-crm-hero-copy">
          <span>Central de relacionamento e vendas</span>
          <h2>
            Seu CRM, do primeiro contato à apólice.
            <b aria-hidden="true">
              <i />
              <i />
              <i />
            </b>
          </h2>
          <p>
            Organize clientes, oportunidades e próximas ações em uma única visão.
          </p>
        </div>

        <div className="landing-crm-hero-actions">
          <span>
            Ver atividades
            <i aria-hidden="true">↗</i>
          </span>
          <b>
            <i aria-hidden="true">+</i>
            Novo atendimento
          </b>
        </div>

        <div className="landing-crm-flow" aria-hidden="true">
          <div className="landing-crm-flow-track">
            <CrmFlowGroup />
            <CrmFlowGroup hidden />
          </div>
        </div>
      </section>

      <section
        className="landing-crm-summary"
        aria-label="Resumo das oportunidades"
        data-product-screen-content
      >
        {[
          ["Em andamento", "12", "Oportunidades que pedem ação"],
          ["Em análise", "05", "Aguardando decisão ou retorno"],
          ["Emitidas", "03", "Atendimentos que viraram apólice"],
        ].map(([label, value, detail], index) => (
          <article key={label}>
            <div>
              <span>{label}</span>
              <p>{detail}</p>
            </div>
            <strong className={index === 1 ? "is-warning" : undefined}>
              {value}
            </strong>
          </article>
        ))}
      </section>

      <div className="landing-crm-workspace-grid">
        <section
          className="landing-crm-pipeline"
          aria-labelledby="landing-crm-pipeline-title"
          data-product-screen-content
        >
          <header>
            <div>
              <span>Pipeline de oportunidades</span>
              <h3 id="landing-crm-pipeline-title">Escolha a próxima ação.</h3>
            </div>
            <b>20 resultados</b>
          </header>

          <div className="landing-crm-toolbar" aria-hidden="true">
            <span>Buscar cliente, produto ou objetivo</span>
            <b>Atualizados recentemente⌄</b>
          </div>

          <div className="landing-crm-stage-tabs" aria-hidden="true">
            {[
              ["Todas", "20"],
              ["Pré-venda", "08"],
              ["Aplicação", "04"],
              ["Em análise", "05"],
              ["Emitidas", "03"],
            ].map(([label, count], index) => (
              <span className={index === 0 ? "is-active" : undefined} key={label}>
                {label}
                <b>{count}</b>
              </span>
            ))}
          </div>

          <div className="landing-crm-list-head" aria-hidden="true">
            <span>Cliente e responsável</span>
            <span>Produto e objetivo</span>
            <span>Valores</span>
            <span>Etapa</span>
          </div>

          <div className="landing-crm-rows">
            {CRM_PREVIEW_ROWS.map((row) => (
              <article data-product-crm-row key={row.client}>
                <div className="landing-crm-person">
                  <b>{row.initials}</b>
                  <span>
                    <strong>{row.client}</strong>
                    <small>{row.owner}</small>
                  </span>
                </div>
                <div>
                  <strong>{row.product}</strong>
                  <small>Proteção planejada</small>
                </div>
                <div>
                  <strong>{row.coverage}</strong>
                  <small>{row.budget}</small>
                </div>
                <span className={`is-${row.tone}`}>
                  <i />
                  {row.status}
                </span>
                <b aria-hidden="true">→</b>
              </article>
            ))}
          </div>
        </section>

        <aside className="landing-crm-next" data-product-screen-content>
          <div>
            <span>Próxima etapa</span>
            <h3>Tudo continua conectado.</h3>
            <p>
              Histórico, pendências e próxima ação acompanham o relacionamento.
            </p>
          </div>

          <div className="landing-crm-next-links">
            {[
              ["Novo atendimento", "Registre a oportunidade"],
              ["Clientes", "Consulte dados e histórico"],
              ["Atividades", "Revise retornos e pendências"],
            ].map(([label, detail]) => (
              <span key={label}>
                <b>
                  {label}
                  <small>{detail}</small>
                </b>
                <i aria-hidden="true">↗</i>
              </span>
            ))}
          </div>

          <footer>
            <span>
              <i />
              Fluxo do CRM
            </span>
            <b>Atendimento → Relacionamento</b>
          </footer>
        </aside>
      </div>
    </div>
  );
}

function CollectionScreen({ data }: { data: CollectionScreenData }) {
  return (
    <div className="landing-product-screen-inner">
      <div className="landing-product-greeting" data-product-screen-content>
        <div>
          <span>{data.eyebrow}</span>
          <h2>{data.title}</h2>
          <p>{data.description}</p>
        </div>
        <span className="landing-product-link">{data.action} ↗</span>
      </div>

      <div className="landing-preview-metrics" data-product-screen-content>
        {data.metrics.map((metric) => (
          <article className={metric.tone ? `is-${metric.tone}` : ""} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>

      <div className="landing-preview-collection-grid">
        <section className="landing-preview-table" data-product-screen-content>
          <header>
            {data.columns.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </header>
          <div>
            {data.rows.map((row) => (
              <article key={row.primary}>
                <strong>{row.primary}</strong>
                <span>{row.secondary}</span>
                <b className={row.tone ? `is-${row.tone}` : ""}>
                  <i />
                  {row.status}
                </b>
              </article>
            ))}
          </div>
        </section>

        <aside className="landing-preview-insight" data-product-screen-content>
          <span>{data.insight.eyebrow}</span>
          <strong>{data.insight.value}</strong>
          <h3>{data.insight.title}</h3>
          <p>{data.insight.body}</p>
          <div>
            <span>{data.insight.progressLabel}</span>
            <i>
              <b
                data-product-progress-bar
                style={{ width: `${data.insight.progress}%` }}
              />
            </i>
          </div>
        </aside>
      </div>
    </div>
  );
}

const MemoTodayScreen = memo(TodayScreen);
const MemoCrmScreen = memo(CrmScreen);
const MemoCollectionScreen = memo(CollectionScreen);

export function PlatformPreview() {
  const scope = useRef<HTMLElement>(null);
  const selectViewRef = useRef<
    (viewId: PreviewViewId, manual?: boolean) => void
  >(() => undefined);
  const transientPauseRef = useRef<(paused: boolean) => void>(() => undefined);
  const togglePauseRef = useRef<() => void>(() => undefined);
  const [activeId, setActiveId] = useState<PreviewViewId>("today");
  const [userPaused, setUserPaused] = useState(false);
  const [autoplayAvailable, setAutoplayAvailable] = useState(true);

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const rootElement = root;

      const screens = new Map<PreviewViewId, HTMLElement>();
      const navButtons = new Map<PreviewViewId, HTMLButtonElement>();

      PREVIEW_VIEWS.forEach((view) => {
        const screen = root.querySelector<HTMLElement>(
          `[data-product-screen="${view.id}"]`,
        );
        const button = root.querySelector<HTMLButtonElement>(
          `[data-product-nav="${view.id}"]`,
        );
        if (screen) screens.set(view.id, screen);
        if (button) navButtons.set(view.id, button);
      });

      const cursor = root.querySelector<HTMLElement>(
        "[data-product-demo-cursor]",
      );
      const progressBars = Array.from(
        root.querySelectorAll<HTMLElement>("[data-product-nav-progress]"),
      );
      const reducedMotionQuery = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );
      const compactQuery = window.matchMedia("(max-width: 959px)");

      let currentId: PreviewViewId = "today";
      let visible = false;
      let userHasPaused = false;
      let transientlyPaused = false;
      let reducedMotion = reducedMotionQuery.matches;
      let compact = compactQuery.matches;
      let transitioning = false;
      let progressTween: gsap.core.Tween | null = null;
      let cursorTimeline: gsap.core.Timeline | null = null;
      let transitionTimeline: gsap.core.Timeline | null = null;
      const animatedScreens = new WeakSet<HTMLElement>();

      const allScreens = Array.from(screens.values());
      gsap.set(allScreens, { autoAlpha: 0, x: 0, scale: 1 });
      const initialScreen = screens.get("today");
      if (initialScreen) gsap.set(initialScreen, { autoAlpha: 1 });
      gsap.set(progressBars, { scaleX: 0, transformOrigin: "left center" });
      if (cursor) gsap.set(cursor, { autoAlpha: 0 });

      function canPlay() {
        return (
          visible &&
          !userHasPaused &&
          !transientlyPaused &&
          !reducedMotion &&
          !compact &&
          !document.hidden
        );
      }

      function killProgress() {
        progressTween?.kill();
        progressTween = null;
        gsap.set(progressBars, { scaleX: 0 });
      }

      function pausePlayback() {
        progressTween?.pause();
        cursorTimeline?.pause();
      }

      function resumePlayback() {
        if (!canPlay()) return;
        let resumedExistingMotion = false;
        if (cursorTimeline?.paused()) {
          cursorTimeline.resume();
          resumedExistingMotion = true;
        }
        if (progressTween?.paused()) {
          progressTween.resume();
          resumedExistingMotion = true;
        }
        if (!resumedExistingMotion && !transitioning) scheduleNext();
      }

      function animateScreenDetails(screen: HTMLElement) {
        const firstPass = !animatedScreens.has(screen);
        animatedScreens.add(screen);
        const content = screen.querySelectorAll<HTMLElement>(
          "[data-product-screen-content]",
        );
        gsap.killTweensOf(content);
        gsap.fromTo(
          content,
          {
            y: firstPass ? 8 : 4,
            opacity: firstPass ? 0.76 : 0.9,
          },
          {
            y: 0,
            opacity: 1,
            duration: firstPass ? 0.38 : 0.24,
            stagger: firstPass ? 0.03 : 0.012,
            ease: "power3.out",
            overwrite: "auto",
          },
        );

        const chartLine = screen.querySelector<SVGPathElement>(
          "[data-product-chart-line]",
        );
        if (chartLine) {
          gsap.killTweensOf(chartLine);
          if (!firstPass) {
            gsap.set(chartLine, {
              strokeDasharray: "none",
              strokeDashoffset: 0,
            });
          } else {
            const length = chartLine.getTotalLength();
            gsap.fromTo(
              chartLine,
              { strokeDasharray: length, strokeDashoffset: length },
              {
                strokeDashoffset: 0,
                duration: 1.2,
                ease: "power2.inOut",
                overwrite: "auto",
              },
            );
          }
        }

        const bars = screen.querySelectorAll<HTMLElement>(
          "[data-product-progress-bar]",
        );
        if (bars.length > 0) {
          gsap.killTweensOf(bars);
          gsap.fromTo(
            bars,
            {
              scaleX: firstPass ? 0 : 0.82,
              transformOrigin: "left center",
            },
            {
              scaleX: 1,
              duration: firstPass ? 0.75 : 0.3,
              stagger: firstPass ? 0.06 : 0.02,
              ease: "power3.out",
              overwrite: "auto",
            },
          );
        }

        const crmRows = screen.querySelectorAll<HTMLElement>(
          "[data-product-crm-row]",
        );
        if (crmRows.length > 0) {
          gsap.killTweensOf(crmRows);
          gsap.fromTo(
            crmRows,
            {
              y: firstPass ? 10 : 3,
              opacity: firstPass ? 0.72 : 0.92,
              scale: firstPass ? 0.99 : 1,
            },
            {
              y: 0,
              opacity: 1,
              scale: 1,
              duration: firstPass ? 0.42 : 0.22,
              stagger: firstPass ? 0.04 : 0.012,
              ease: "power3.out",
              overwrite: "auto",
            },
          );
        }
      }

      function settleScreen(screen: HTMLElement) {
        const content = screen.querySelectorAll<HTMLElement>(
          "[data-product-screen-content]",
        );
        gsap.killTweensOf(content);
        gsap.set(content, { y: 0, opacity: 1 });

        const chartLine = screen.querySelector<SVGPathElement>(
          "[data-product-chart-line]",
        );
        if (chartLine) {
          gsap.killTweensOf(chartLine);
          gsap.set(chartLine, { strokeDasharray: "none", strokeDashoffset: 0 });
        }

        const bars = screen.querySelectorAll<HTMLElement>(
          "[data-product-progress-bar]",
        );
        gsap.killTweensOf(bars);
        gsap.set(bars, { scaleX: 1 });

        const crmRows = screen.querySelectorAll<HTMLElement>(
          "[data-product-crm-row]",
        );
        gsap.killTweensOf(crmRows);
        gsap.set(crmRows, { y: 0, opacity: 1, scale: 1 });
      }

      function settleTransition() {
        transitionTimeline?.kill();
        transitionTimeline = null;
        transitioning = false;

        gsap.set(allScreens, {
          autoAlpha: 0,
          x: 0,
          y: 0,
          scale: 1,
          zIndex: 0,
          willChange: "auto",
        });

        const settledScreen = screens.get(currentId);
        if (settledScreen) {
          gsap.set(settledScreen, { autoAlpha: 1 });
          settleScreen(settledScreen);
        }
      }

      function scheduleNext() {
        killProgress();
        if (!canPlay() || transitioning) return;
        const activeButton = navButtons.get(currentId);
        const progress = activeButton?.querySelector<HTMLElement>(
          "[data-product-nav-progress]",
        );
        if (!progress) return;

        progressTween = gsap.to(progress, {
          scaleX: 1,
          duration: 2.8,
          ease: "none",
          onComplete: () => {
            progressTween = null;
            const currentIndex = PREVIEW_VIEWS.findIndex(
              (view) => view.id === currentId,
            );
            const nextView =
              PREVIEW_VIEWS[(currentIndex + 1) % PREVIEW_VIEWS.length];
            animateCursorTo(nextView.id);
          },
        });
      }

      function showScreen(nextId: PreviewViewId, manual = false) {
        if (manual) {
          userHasPaused = true;
          transientlyPaused = false;
          setUserPaused(true);
          cursorTimeline?.kill();
          cursorTimeline = null;
          if (cursor) gsap.set(cursor, { autoAlpha: 0 });
        }

        killProgress();
        if (transitioning) settleTransition();
        if (nextId === currentId) return;

        const outgoing = screens.get(currentId);
        const incoming = screens.get(nextId);
        if (!outgoing || !incoming) return;

        if (reducedMotion || compact) {
          gsap.set(outgoing, {
            autoAlpha: 0,
            x: 0,
            y: 0,
            scale: 1,
            zIndex: 0,
            willChange: "auto",
          });
          gsap.set(incoming, {
            autoAlpha: 1,
            x: 0,
            y: 0,
            scale: 1,
            zIndex: 0,
            willChange: "auto",
          });
          currentId = nextId;
          setActiveId(nextId);
          settleScreen(incoming);
          return;
        }

        transitioning = true;
        gsap.set(incoming, {
          autoAlpha: 0,
          y: 7,
          zIndex: 2,
          willChange: "transform,opacity",
        });
        gsap.set(outgoing, {
          zIndex: 1,
          willChange: "transform,opacity",
        });
        currentId = nextId;
        setActiveId(nextId);
        animateScreenDetails(incoming);

        transitionTimeline = gsap
          .timeline({
            onComplete: () => {
              gsap.set(outgoing, {
                autoAlpha: 0,
                x: 0,
                y: 0,
                scale: 1,
                zIndex: 0,
                willChange: "auto",
              });
              gsap.set(incoming, {
                clearProps: "x,y,scale,zIndex,willChange",
              });
              transitionTimeline = null;
              transitioning = false;
              scheduleNext();
            },
          })
          .to(
            outgoing,
            {
              autoAlpha: 0,
              y: -4,
              duration: 0.22,
              ease: "power2.out",
              force3D: true,
            },
            0,
          )
          .to(
            incoming,
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.3,
              ease: "power3.out",
              force3D: true,
            },
            0.035,
          );
      }

      function animateCursorTo(nextId: PreviewViewId) {
        const target = navButtons.get(nextId);
        const currentButton = navButtons.get(currentId);
        if (!cursor || !target || !currentButton || !canPlay()) {
          showScreen(nextId);
          return;
        }

        const rootRect = rootElement.getBoundingClientRect();
        const startRect = currentButton.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const toPoint = (rect: DOMRect) => ({
          x: rect.right - rootRect.left - 22,
          y: rect.top - rootRect.top + rect.height / 2 - 8,
        });

        cursorTimeline?.kill();
        gsap.set(cursor, { ...toPoint(startRect), autoAlpha: 1, scale: 1 });
        cursorTimeline = gsap
          .timeline({
            onComplete: () => {
              cursorTimeline = null;
            },
          })
          .to(cursor, {
            ...toPoint(targetRect),
            duration: 0.55,
            ease: "power3.inOut",
          })
          .to(cursor, {
            scale: 0.76,
            duration: 0.12,
            yoyo: true,
            repeat: 1,
            ease: "power2.inOut",
          })
          .call(() => showScreen(nextId))
          .to(cursor, { autoAlpha: 0, duration: 0.22, ease: "power2.out" });
      }

      function syncCapabilities() {
        reducedMotion = reducedMotionQuery.matches;
        compact = compactQuery.matches;
        const available = !reducedMotion && !compact;
        setAutoplayAvailable(available);

        if (!available) {
          killProgress();
          cursorTimeline?.kill();
          cursorTimeline = null;
          transitionTimeline?.kill();
          transitionTimeline = null;
          transitioning = false;
          if (cursor) gsap.set(cursor, { autoAlpha: 0 });
          if (compact) currentId = "today";
          gsap.set(allScreens, { autoAlpha: 0, x: 0, scale: 1, zIndex: 0 });
          const settledScreen = screens.get(currentId);
          if (settledScreen) {
            gsap.set(settledScreen, { autoAlpha: 1 });
            settleScreen(settledScreen);
          }
          setActiveId(currentId);
          return;
        }
        resumePlayback();
      }

      selectViewRef.current = (viewId, manual = true) =>
        showScreen(viewId, manual);
      transientPauseRef.current = (paused) => {
        transientlyPaused = paused;
        if (paused) pausePlayback();
        else resumePlayback();
      };
      togglePauseRef.current = () => {
        userHasPaused = !userHasPaused;
        transientlyPaused = false;
        setUserPaused(userHasPaused);
        if (userHasPaused) pausePlayback();
        else resumePlayback();
      };

      const stageTrigger = ScrollTrigger.create({
        trigger: root,
        start: "top 82%",
        end: "bottom 18%",
        onEnter: () => {
          visible = true;
          if (initialScreen) {
            if (reducedMotion) settleScreen(initialScreen);
            else animateScreenDetails(initialScreen);
          }
          resumePlayback();
        },
        onEnterBack: () => {
          visible = true;
          resumePlayback();
        },
        onLeave: () => {
          visible = false;
          pausePlayback();
        },
        onLeaveBack: () => {
          visible = false;
          pausePlayback();
        },
      });

      const handleVisibility = () => {
        if (document.hidden) pausePlayback();
        else resumePlayback();
      };

      reducedMotionQuery.addEventListener("change", syncCapabilities);
      compactQuery.addEventListener("change", syncCapabilities);
      document.addEventListener("visibilitychange", handleVisibility);
      syncCapabilities();

      return () => {
        stageTrigger.kill();
        progressTween?.kill();
        cursorTimeline?.kill();
        transitionTimeline?.kill();
        reducedMotionQuery.removeEventListener("change", syncCapabilities);
        compactQuery.removeEventListener("change", syncCapabilities);
        document.removeEventListener("visibilitychange", handleVisibility);
        selectViewRef.current = () => undefined;
        transientPauseRef.current = () => undefined;
        togglePauseRef.current = () => undefined;
      };
    },
    { scope },
  );

  function selectView(viewId: PreviewViewId) {
    selectViewRef.current(viewId, true);
  }

  function handleTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentId: PreviewViewId,
  ) {
    const currentIndex = PREVIEW_VIEWS.findIndex(
      (view) => view.id === currentId,
    );
    let nextIndex = currentIndex;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % PREVIEW_VIEWS.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + PREVIEW_VIEWS.length) % PREVIEW_VIEWS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = PREVIEW_VIEWS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextView = PREVIEW_VIEWS[nextIndex];
    selectView(nextView.id);
    requestAnimationFrame(() => {
      scope.current
        ?.querySelector<HTMLButtonElement>(
          `[data-product-nav="${nextView.id}"]`,
        )
        ?.focus();
    });
  }

  return (
    <section
      ref={scope}
      className="landing-product-stage landing-product-demo"
      data-product-stage
      data-product-demo
      aria-label="Demonstração navegável da plataforma Keepr One"
      onFocusCapture={() => transientPauseRef.current(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          transientPauseRef.current(false);
        }
      }}
    >
      <aside
        className="landing-product-sidebar"
        onPointerEnter={() => transientPauseRef.current(true)}
        onPointerLeave={() => transientPauseRef.current(false)}
      >
        <Logo size={30} variant="onLight" className="text-base text-white" />

        <div className="landing-product-workspace-card">
          <span>Workspace</span>
          <b>Agência conectada</b>
        </div>

        <div
          className="landing-product-nav"
          role="tablist"
          aria-label="Navegação da demonstração"
          aria-orientation="vertical"
        >
          {PREVIEW_VIEWS.map((view, index) => {
            const active = view.id === activeId;
            const beginsGroup =
              index === 0 || PREVIEW_VIEWS[index - 1]?.group !== view.group;
            return (
              <Fragment key={view.id}>
                {beginsGroup ? (
                  <span
                    className="landing-product-nav-group"
                    role="presentation"
                  >
                    {view.group}
                  </span>
                ) : null}
                <button
                  type="button"
                  role="tab"
                  id={`product-preview-tab-${view.id}`}
                  aria-controls={`product-preview-panel-${view.id}`}
                  aria-selected={active}
                  className={active ? "is-active" : undefined}
                  data-product-nav={view.id}
                  onClick={() => selectView(view.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, view.id)}
                  tabIndex={active ? 0 : -1}
                >
                  <NavIcon name={view.icon} size={16} />
                  <span>{view.label}</span>
                  <i data-product-nav-progress />
                </button>
              </Fragment>
            );
          })}
        </div>

        <div className="landing-product-agent">
          <b>AB</b>
          <span>
            Agente Base
            <small>Área do agente</small>
          </span>
        </div>
      </aside>

      <div className="landing-product-workspace">
        <header className="landing-product-topbar">
          <div className="landing-product-header-title">
            <small>keepr one</small>
            <div>
              <strong>
                {PREVIEW_VIEWS.find((view) => view.id === activeId)?.pageTitle}
              </strong>
              <i />
              <span>
                <b />
                Operação conectada
              </span>
            </div>
          </div>

          <div className="landing-product-header-actions">
            {autoplayAvailable ? (
              <button type="button" onClick={() => togglePauseRef.current()}>
                {userPaused ? "Retomar demo" : "Pausar demo"}
              </button>
            ) : null}
            <span>Área do agente</span>
            <button type="button" onClick={() => selectView("crm")}>
              <b>+</b>
              Novo atendimento
            </button>
          </div>
        </header>

        <div className="landing-product-viewport" aria-live="off">
          {PREVIEW_VIEWS.map((view) => {
            const active = view.id === activeId;
            return (
              <section
                role="tabpanel"
                id={`product-preview-panel-${view.id}`}
                aria-labelledby={`product-preview-tab-${view.id}`}
                aria-hidden={!active}
                className={`landing-product-screen${active ? " is-active" : ""}`}
                data-product-screen={view.id}
                key={view.id}
              >
                {view.id === "today" ? <MemoTodayScreen /> : null}
                {view.id === "crm" ? <MemoCrmScreen /> : null}
                {view.id !== "today" && view.id !== "crm" ? (
                  <MemoCollectionScreen data={COLLECTION_SCREENS[view.id]} />
                ) : null}
              </section>
            );
          })}
        </div>
      </div>

      <span
        className="landing-product-demo-cursor"
        data-product-demo-cursor
        aria-hidden="true"
      />
    </section>
  );
}
