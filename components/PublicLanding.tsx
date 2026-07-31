import Link from "next/link";
import { DailyVisionTabs } from "@/components/DailyVisionTabs";
import { Logo, LogoMark } from "@/components/Logo";
import { PlatformPreview } from "@/components/PlatformPreview";
import { PricingSection } from "@/components/PricingSection";
import { PublicLandingMotion } from "@/components/PublicLandingMotion";

const marqueeItems = [
  "Casos em movimento",
  "Carteira organizada",
  "Comissões visíveis",
  "Prioridades claras",
  "Equipe conectada",
];

const appLoginUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://app.keeprone.com").replace(
  /\/$/,
  "",
)}\/login`;

const footerSignals = [
  "Registro completo",
  "Carteira acompanhada",
  "Prioridades visíveis",
  "Resultado conciliado",
];

const crmPipelinePreview = [
  {
    count: "01",
    title: "Ana Ribeiro · Auto",
    detail: "Proposta enviada",
    status: "Hoje",
  },
  {
    count: "02",
    title: "Carlos Rocha · Vida",
    detail: "Documentação em análise",
    status: "Em curso",
  },
  {
    count: "03",
    title: "Marina Costa · Residencial",
    detail: "Apólice emitida",
    status: "Ativa",
    complete: true,
  },
];

const operationStages = [
  "Atendimento",
  "Caso",
  "Apólice",
  "Comissão",
  "Carteira",
];

function MarqueeGroup({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="landing-marquee-group" aria-hidden={hidden || undefined}>
      {marqueeItems.map((item) => (
        <span key={item}>
          {item}
          <i />
        </span>
      ))}
    </div>
  );
}

function FooterSignalGroup({ hidden = false }: { hidden?: boolean }) {
  return (
    <div
      className="landing-footer-marquee-group"
      aria-hidden={hidden || undefined}
    >
      {footerSignals.map((item) => (
        <span key={item}>
          {item}
          <i />
        </span>
      ))}
    </div>
  );
}

export function PublicLanding() {
  return (
    <PublicLandingMotion>
      <main className="landing-root" id="inicio">
        <header className="landing-header" data-landing-nav>
          <nav className="landing-nav" aria-label="Navegação principal">
            <Link
              className="landing-nav-brand"
              data-landing-brand
              href="/"
              aria-label="Keepr One — página inicial"
            >
              <Logo size={32} variant="onLight" className="text-white" />
            </Link>

            <div className="landing-nav-links">
              <a href="#plataforma">Plataforma</a>
              <a href="#operacao">Como funciona</a>
              <a href="#visao">Sua visão</a>
              <a href="#planos">Planos</a>
            </div>

              <Link className="landing-nav-cta" href={appLoginUrl}>
              Entrar
              <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </header>

        <section className="landing-hero landing-dark-texture" data-hero>
          <div className="landing-hero-aura" data-hero-aura aria-hidden="true" />
          <div className="landing-grain" aria-hidden="true" />

          <div className="landing-wrap landing-hero-inner">
            <p className="landing-hero-kicker" data-hero-kicker>
              <span>A central de operação do</span>
              <strong data-hero-audience>
                agente financeiro
                <i aria-hidden="true" />
              </strong>
            </p>

            <h1 className="landing-hero-title">
              <span className="landing-title-mask">
                <span data-hero-line>Toda a sua operação.</span>
              </span>
              <span className="landing-title-mask">
                <span data-hero-line>Sob controle.</span>
              </span>
            </h1>

            <p className="landing-hero-copy" data-hero-support>
              Do primeiro contato à comissão paga, a Keepr One reúne clientes,
              casos, apólices e equipe para você acompanhar o trabalho,
              proteger a carteira e decidir sem alternar entre ferramentas.
            </p>

            <div className="landing-hero-actions" data-hero-support>
              <a className="landing-button landing-button-primary" href="#plataforma">
                Conhecer a plataforma
                <span aria-hidden="true">↓</span>
              </a>
              <Link className="landing-button landing-button-ghost" href={appLoginUrl}>
                Entrar na Keepr One
                <span aria-hidden="true">↗</span>
              </Link>
            </div>

            <PlatformPreview />
          </div>
        </section>

        <div className="landing-marquee" aria-label={marqueeItems.join(", ")}>
          <div className="landing-marquee-track" data-landing-marquee>
            <MarqueeGroup />
            <MarqueeGroup hidden />
          </div>
        </div>

        <section
          className="landing-interest landing-light-texture keepr-noise"
          id="plataforma"
        >
          <div className="landing-wrap">
            <div className="landing-section-intro">
              <h2 data-copy-reveal>
                Menos telas abertas.
                <br />
                Mais clareza para agir.
              </h2>
              <p data-copy-reveal>
                A Keepr One transforma sinais dispersos em uma visão
                operacional: o que avançou, o que exige atenção e onde está o
                resultado.
              </p>
            </div>

            <div className="landing-bento">
              <article
                className="landing-bento-card landing-bento-main"
                data-image-reveal
              >
                <div className="landing-bento-main-head">
                  <div className="landing-bento-copy">
                    <span>Operação conectada</span>
                    <h3>Um caso. Tudo no mesmo lugar.</h3>
                    <p>
                      Cliente, apólice, pendências e resultado permanecem
                      ligados à mesma história.
                    </p>
                  </div>
                  <span className="landing-flow-status">
                    <i />
                    Fluxo ativo
                  </span>
                </div>

                <div
                  className="landing-context-snapshot"
                  aria-label="Exemplo ilustrativo de um caso com seus dados reunidos"
                  role="group"
                >
                  <div className="landing-context-core">
                    <span>Caso em andamento</span>
                    <b>Renovação de carteira</b>
                    <small>Próxima ação · revisar documentação</small>
                  </div>
                  <ul>
                    {[
                      ["Cliente", "Histórico completo"],
                      ["Apólice", "Em análise"],
                      ["Comissão", "Vinculada"],
                    ].map(([label, status]) => (
                      <li data-flow-step key={label}>
                        <span>{label}</span>
                        <b>{status}</b>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="landing-bento-foot">
                  <span>
                    <i />
                    Histórico do caso
                  </span>
                  <Link className="landing-inline-link" href="#operacao">
                    Ver fluxo completo
                    <span aria-hidden="true">↘</span>
                  </Link>
                </div>
              </article>

              <article
                className="landing-bento-card landing-bento-queue"
                data-image-reveal
              >
                <div className="landing-bento-copy">
                  <span>Sua fila</span>
                  <h3>O próximo passo já vem priorizado.</h3>
                  <p>
                    Ações que destravam casos ou protegem a carteira aparecem
                    primeiro.
                  </p>
                </div>
                <ol
                  className="landing-mini-queue"
                  aria-label="Exemplo de fila de prioridades"
                >
                  <li>
                    <b>02</b>
                    <span>Apólices em risco</span>
                    <i>Agora</i>
                  </li>
                  <li>
                    <b>03</b>
                    <span>Follow-ups</span>
                    <i>Hoje</i>
                  </li>
                  <li>
                    <b>01</b>
                    <span>Revisão anual</span>
                    <i>Próximo</i>
                  </li>
                </ol>
              </article>

              <article
                className="landing-bento-card landing-bento-money"
                data-image-reveal
              >
                <div className="landing-bento-copy">
                  <span>Comissões</span>
                  <h3>Resultado legível antes do fechamento.</h3>
                  <p>
                    Esperado e conciliado na mesma leitura, ligados à origem.
                  </p>
                </div>
                <div
                  className="landing-money-visual"
                  aria-label="Estados de comissão acompanhados pela Keepr One"
                  role="group"
                >
                  <div>
                    <span>Conciliada</span>
                    <b>Visível</b>
                  </div>
                  <ul>
                    <li>
                      <i />
                      Esperada
                    </li>
                    <li className="is-positive">
                      <i />
                      Paga
                    </li>
                    <li className="is-alert">
                      <i />
                      Chargeback
                    </li>
                  </ul>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section
          className="landing-journey landing-dark-texture"
          id="operacao"
          aria-labelledby="operacao-title"
        >
          <div className="landing-grain" aria-hidden="true" />
          <div className="landing-wrap">
            <div className="landing-journey-heading">
              <span className="landing-section-index">
                CRM operacional para agentes financeiros
              </span>
              <h2 data-copy-reveal id="operacao-title">
                Organize o atendimento. Acompanhe cada apólice. Gerencie a
                agência.
              </h2>
              <div className="landing-journey-summary" data-copy-reveal>
                <p>
                  A Keepr One conecta clientes, casos, apólices, equipe e
                  comissões para você conduzir a carteira em um só lugar — sem
                  planilhas paralelas nem perda de histórico.
                </p>
                <ul aria-label="Recursos do CRM Keepr One">
                  <li data-crm-detail>
                    <b>Atendimento</b>
                    <span>Histórico, tarefas e próximo passo</span>
                  </li>
                  <li data-crm-detail>
                    <b>Apólices</b>
                    <span>Emissão, vigência e revisão</span>
                  </li>
                  <li data-crm-detail>
                    <b>Gestão</b>
                    <span>Carteira, equipe e comissões</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="landing-feature-grid">
              <article
                className="landing-feature-card landing-feature-priority"
                data-journey-panel
              >
                <div className="landing-feature-copy">
                  <span>Atendimento organizado</span>
                  <h3>Cada cliente avança com histórico e próximo passo.</h3>
                  <p>
                    Contatos, tarefas, documentos e pendências ficam ligados ao
                    mesmo caso para a equipe continuar de onde parou.
                  </p>
                </div>

                <div className="landing-feature-window landing-priority-window">
                  <div className="landing-window-topbar">
                    <span>
                      <i />
                      Pipeline de atendimento
                    </span>
                    <b>Visão ilustrativa</b>
                  </div>

                  <ol
                    className="landing-priority-preview"
                    aria-label="Exemplo de atendimentos organizados no CRM Keepr One"
                  >
                    {crmPipelinePreview.map((item) => (
                      <li
                        className={item.complete ? "is-complete" : undefined}
                        data-journey-cue
                        key={item.title}
                      >
                        <b>{item.count}</b>
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <i>{item.status}</i>
                      </li>
                    ))}
                  </ol>

                  <div className="landing-priority-insight">
                    <span aria-hidden="true">✓</span>
                    <p>
                      <b>Próximo passo definido.</b>
                      Histórico, documentos e follow-up seguem juntos no mesmo
                      caso.
                    </p>
                  </div>
                </div>
              </article>

              <article
                className="landing-feature-card landing-feature-performance"
                data-journey-panel
              >
                <div className="landing-feature-copy">
                  <span>Gestão da agência</span>
                  <h3>A apólice foi gerada. A gestão continua.</h3>
                  <p>
                    Acompanhe vigência, carteira, produção e comissões para
                    entender o resultado de cada operação.
                  </p>
                </div>

                <figure
                  className="landing-feature-window landing-performance-window"
                  aria-describedby="landing-performance-caption"
                >
                  <div className="landing-window-topbar">
                    <span>
                      <i />
                      Visão da agência
                    </span>
                    <b>Últimos 6 meses</b>
                  </div>

                  <div className="landing-performance-summary">
                    <span>
                      <small>Comissões conciliadas</small>
                      <strong data-journey-chart-value>76%</strong>
                    </span>
                    <b>+18% no período</b>
                  </div>

                  <div className="landing-performance-chart" aria-hidden="true">
                    <svg viewBox="0 0 620 220" preserveAspectRatio="none">
                      <defs>
                        <linearGradient
                          id="landing-journey-chart-fill"
                          x1="0"
                          x2="0"
                          y1="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#65e497"
                            stopOpacity=".34"
                          />
                          <stop
                            offset="100%"
                            stopColor="#65e497"
                            stopOpacity="0"
                          />
                        </linearGradient>
                      </defs>
                      {[42, 98, 154].map((y) => (
                        <line
                          key={y}
                          x1="0"
                          x2="620"
                          y1={y}
                          y2={y}
                          stroke="rgba(255,255,255,.08)"
                          strokeDasharray="4 8"
                        />
                      ))}
                      <path
                        data-journey-chart-area
                        d="M0 182 C66 178 85 165 124 168 C178 172 190 123 247 128 C308 133 318 91 375 96 C437 101 463 52 516 64 C563 75 582 40 620 35 L620 220 L0 220 Z"
                        fill="url(#landing-journey-chart-fill)"
                      />
                      <path
                        data-journey-chart-line
                        d="M0 182 C66 178 85 165 124 168 C178 172 190 123 247 128 C308 133 318 91 375 96 C437 101 463 52 516 64 C563 75 582 40 620 35"
                        fill="none"
                        stroke="#65e497"
                        strokeWidth="3"
                        vectorEffect="non-scaling-stroke"
                      />
                      {[
                        [0, 182],
                        [124, 168],
                        [247, 128],
                        [375, 96],
                        [516, 64],
                        [620, 35],
                      ].map(([cx, cy]) => (
                        <circle
                          cx={cx}
                          cy={cy}
                          data-journey-chart-point
                          fill="#f7f8f5"
                          key={`${cx}-${cy}`}
                          r="4"
                        />
                      ))}
                    </svg>
                    <span className="landing-chart-callout">
                      Jul
                      <b>76%</b>
                    </span>
                  </div>

                  <div className="landing-performance-markers">
                    {[
                      ["Fev", "28%"],
                      ["Mar", "31%"],
                      ["Abr", "46%"],
                      ["Mai", "58%"],
                      ["Jun", "66%"],
                      ["Jul", "76%"],
                    ].map(([month, value]) => (
                      <span
                        aria-label={`${month}: ${value} conciliado`}
                        key={month}
                        tabIndex={0}
                      >
                        {month}
                        <i>
                          {month}
                          <b>{value}</b>
                        </i>
                      </span>
                    ))}
                  </div>

                  <div className="landing-performance-legend" aria-hidden="true">
                    <span>
                      <i className="is-solid" />
                      Conciliado 76%
                    </span>
                    <span>
                      <i />
                      Em validação 24%
                    </span>
                  </div>
                  <figcaption
                    className="sr-only"
                    id="landing-performance-caption"
                  >
                    Evolução ilustrativa das comissões conciliadas: 28 por
                    cento em fevereiro, 31 em março, 46 em abril, 58 em maio, 66
                    em junho e 76 por cento em julho.
                  </figcaption>
                </figure>
              </article>
            </div>

            <ol
              className="landing-operation-rail"
              aria-label="Etapas conectadas da operação"
              tabIndex={0}
            >
              {operationStages.map((stage, index) => (
                <li
                  className={index <= 3 ? "is-complete" : undefined}
                  data-operation-stage
                  key={stage}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <b>{stage}</b>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className="landing-questions landing-light-texture keepr-noise"
          id="visao"
        >
          <div className="landing-wrap">
            <div className="landing-questions-layout">
              <div className="landing-questions-heading" data-vision-heading>
                <h2 data-copy-reveal>
                  Menos procura.
                  <span className="landing-vision-inline" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  Mais direção.
                </h2>
                <p data-copy-reveal>
                  Prioridades, casos, comissões e carteira organizados em uma
                  única leitura, com tudo o que você precisa para decidir.
                </p>
              </div>

              <DailyVisionTabs />
            </div>
          </div>
        </section>

        <PricingSection />

        <section
          className="landing-final landing-light-texture keepr-noise"
          aria-labelledby="landing-final-title"
          id="comecar"
        >
          <div className="landing-final-orbit" aria-hidden="true" />
          <div className="landing-wrap landing-final-inner">
            <div className="landing-final-copy" data-final-copy>
              <span className="landing-section-index">
                Coloque a operação no centro
              </span>
              <h2 id="landing-final-title" data-copy-reveal>
                Sua agência não precisa de mais planilhas. Precisa de uma visão
                clara.
              </h2>
              <p data-copy-reveal>
                Centralize atendimento, apólices, carteira e comissões em um
                CRM feito para o fluxo real de quem vende e cuida de seguros.
              </p>
              <div className="landing-final-actions" data-copy-reveal>
                <a
                  className="landing-button landing-final-primary"
                  href="#planos"
                >
                  Ver planos
                  <span aria-hidden="true">↑</span>
                </a>
                <Link
                  className="landing-final-secondary"
                  href={appLoginUrl}
                >
                  Já sou cliente
                  <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </div>

            <div className="landing-final-demo" data-final-stage>
              <div className="landing-final-demo-topbar">
                <span>
                  <i aria-hidden="true" />
                  Operação em movimento
                </span>
                <b>Visão ilustrativa</b>
              </div>

              <ol
                className="landing-final-stack"
                aria-label="Exemplo da operação conectada no CRM"
              >
                <li className="is-service" data-final-card>
                  <div className="landing-final-card-surface">
                    <div>
                      <span>Atendimento</span>
                      <b>12 próximos passos organizados</b>
                      <small>Histórico e follow-up no mesmo lugar</small>
                    </div>
                    <i>Hoje</i>
                  </div>
                </li>
                <li className="is-policy" data-final-card>
                  <div className="landing-final-card-surface">
                    <div>
                      <span>Apólices</span>
                      <b>8 emissões acompanhadas</b>
                      <small>Vigência, revisão e carteira visíveis</small>
                    </div>
                    <i>Em curso</i>
                  </div>
                </li>
                <li className="is-result" data-final-card>
                  <div className="landing-final-card-surface">
                    <div>
                      <span>Gestão da agência</span>
                      <b>$18.420 em comissões visíveis</b>
                      <small>Produção e resultado sem conciliação paralela</small>
                    </div>
                    <i>+18%</i>
                  </div>
                </li>
              </ol>

              <div className="landing-final-demo-foot">
                <span>
                  <i aria-hidden="true" />
                  Operação registrada
                </span>
                <b>Do contato ao resultado</b>
              </div>
            </div>
          </div>
        </section>

        <footer className="landing-footer landing-dark-texture">
          <div className="landing-grain" aria-hidden="true" />
          <div className="landing-footer-aura" aria-hidden="true" />

          <div
            className="landing-footer-marquee"
            aria-hidden="true"
          >
            <div className="landing-footer-marquee-track" data-footer-marquee>
              <FooterSignalGroup />
              <FooterSignalGroup hidden />
            </div>
          </div>

          <div className="landing-wrap landing-footer-inner">
            <div className="landing-footer-heading" data-footer-panel>
              <a
                className="landing-footer-mark"
                data-footer-mark
                href="#inicio"
                aria-label="Keepr One — voltar ao início"
              >
                <LogoMark size={72} />
              </a>

              <div className="landing-footer-heading-copy">
                <p>Do primeiro contato à comissão paga.</p>
                <h2>O próximo passo fica claro.</h2>
              </div>

              <Link className="landing-footer-entry" href={appLoginUrl}>
                <span>Acessar a plataforma</span>
                <i aria-hidden="true">↗</i>
              </Link>
            </div>

            <div className="landing-footer-grid">
              <div className="landing-footer-story" data-footer-panel>
                <div>
                  <span>Uma visão contínua da operação</span>
                  <h3>Clareza que acompanha o agente de ponta a ponta.</h3>
                </div>
                <p>
                  Clientes, casos, apólices, equipe e comissões conectados para
                  transformar informação dispersa em direção prática.
                </p>
                <ul aria-label="Benefícios da plataforma">
                  <li>
                    <i />
                    Trabalho priorizado
                  </li>
                  <li>
                    <i />
                    Carteira protegida
                  </li>
                  <li>
                    <i />
                    Resultado legível
                  </li>
                </ul>
              </div>

              <nav
                className="landing-footer-links"
                aria-label="Navegação do rodapé"
                data-footer-panel
              >
                <a href="#plataforma">
                  <span>Plataforma</span>
                  <i aria-hidden="true">↗</i>
                </a>
                <a href="#operacao">
                  <span>Como funciona</span>
                  <i aria-hidden="true">↗</i>
                </a>
                <a href="#visao">
                  <span>Sua visão</span>
                  <i aria-hidden="true">↗</i>
                </a>
                <a href="#planos">
                  <span>Planos</span>
                  <i aria-hidden="true">↗</i>
                </a>
                <Link href={appLoginUrl}>
                  <span>Entrar</span>
                  <i aria-hidden="true">↗</i>
                </Link>
              </nav>
            </div>

            <div className="landing-footer-bottom" data-footer-panel>
              <p>© 2026 Keepr One. Todos os direitos reservados.</p>
              <div>
                <span>
                  <i />
                  Feito para agentes financeiros
                </span>
                <a href="#inicio">
                  Voltar ao topo
                  <i aria-hidden="true">↑</i>
                </a>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </PublicLandingMotion>
  );
}
