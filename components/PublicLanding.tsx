import type { CSSProperties } from "react";
import Link from "next/link";
import { Logo, LogoMark } from "@/components/Logo";
import { PublicLandingMotion } from "@/components/PublicLandingMotion";

const marqueeItems = [
  "Casos em movimento",
  "Carteira organizada",
  "Comissões visíveis",
  "Prioridades claras",
  "Equipe conectada",
];

const journey = [
  {
    number: "01",
    eyebrow: "Caso",
    title: "O trabalho começa com direção.",
    body: "Cliente, objetivo e próxima ação permanecem dentro do mesmo fluxo — desde o primeiro contato.",
    signal: "Novo caso",
    detail: "Próxima ação definida",
  },
  {
    number: "02",
    eyebrow: "Requirements",
    title: "Pendências deixam de ser invisíveis.",
    body: "Requirements e documentos ganham contexto para você identificar o que bloqueia cada avanço.",
    signal: "Em análise",
    detail: "2 itens para revisar",
  },
  {
    number: "03",
    eyebrow: "Apólice",
    title: "Cada apólice continua viva.",
    body: "Status, informações essenciais e pontos de atenção ficam acessíveis para acompanhar a carteira.",
    signal: "Emitida",
    detail: "Carteira atualizada",
  },
  {
    number: "04",
    eyebrow: "Comissão",
    title: "Remuneração deixa de ser surpresa.",
    body: "Diferencie o que é esperado, pago ou chargeback sem desconectar o valor da origem.",
    signal: "Pagamento",
    detail: "Conciliação visível",
  },
  {
    number: "05",
    eyebrow: "Relacionamento",
    title: "A próxima ação já nasce com contexto.",
    body: "Follow-ups, revisões e equipe aparecem como continuidade da operação, não como tarefas soltas.",
    signal: "Revisão anual",
    detail: "Relacionamento ativo",
  },
];

const operationQuestions = [
  {
    number: "01",
    question: "O que precisa da minha atenção hoje?",
    answer: "Fila de prioridades",
  },
  {
    number: "02",
    question: "O que avançou em cada caso?",
    answer: "Histórico e status",
  },
  {
    number: "03",
    question: "O que entrou — e o que ainda é esperado?",
    answer: "Visão de comissões",
  },
  {
    number: "04",
    question: "Onde minha carteira pede cuidado?",
    answer: "Apólices e revisões",
  },
];

function ProductStage() {
  return (
    <div
      className="landing-product-stage"
      data-product-stage
      role="img"
      aria-label="Visão ilustrativa da central de operação Keepr One, com comissões, fila de prioridades e evolução mensal."
    >
      <div className="landing-product-topbar">
        <div className="landing-product-brand">
          <LogoMark size={22} />
          <span>Operação conectada</span>
        </div>
        <div className="landing-product-period">
          <span className="landing-status-dot" />
          Julho · visão mensal
        </div>
      </div>

      <div className="landing-product-body">
        <aside className="landing-product-sidebar" aria-hidden="true">
          <LogoMark size={25} />
          <div className="landing-product-nav">
            {["Hoje", "Casos", "Clientes", "Apólices", "Comissões"].map(
              (item, index) => (
                <span
                  className={index === 0 ? "is-active" : undefined}
                  key={item}
                >
                  <i />
                  {item}
                </span>
              ),
            )}
          </div>
          <div className="landing-product-agent">
            <b>AB</b>
            <span>
              Agente Base
              <small>Área do agente</small>
            </span>
          </div>
        </aside>

        <div className="landing-product-main">
          <div className="landing-product-greeting">
            <div>
              <span>Bom dia, agente.</span>
              <h2>Estas são suas comissões neste mês.</h2>
            </div>
            <span className="landing-product-link">Ver extrato ↗</span>
          </div>

          <div className="landing-product-grid">
            <section className="landing-commission-panel">
              <div className="landing-commission-value">
                <strong>$300</strong>
                <span>
                  <b>↑ 45%</b>
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
                    <linearGradient id="landing-chart-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#65e497" stopOpacity=".36" />
                      <stop offset="100%" stopColor="#65e497" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0 148 C78 148 116 148 172 148 C223 148 238 101 291 92 C352 83 370 40 432 38 C493 36 520 73 600 58 L600 170 L0 170 Z"
                    fill="url(#landing-chart-fill)"
                  />
                  <path
                    data-chart-line
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
                  <b>$0</b>
                </span>
                <span>
                  <small>Paga</small>
                  <b className="is-green">$0</b>
                </span>
                <span>
                  <small>Chargebacks</small>
                  <b>$0</b>
                </span>
              </div>
            </section>

            <aside className="landing-priority-panel">
              <div className="landing-priority-heading">
                <div>
                  <span>Sua fila</span>
                  <h3>Prioridades de hoje</h3>
                </div>
                <b>2</b>
              </div>
              <p>Comece pelo que pode mover resultado ou proteger sua carteira.</p>
              <div className="landing-priority-list">
                {[
                  ["0", "Follow-ups pendentes"],
                  ["0", "Requirements abertos"],
                  ["2", "Apólices em risco"],
                  ["0", "Revisões anuais"],
                ].map(([count, label]) => (
                  <span key={label} className={count === "2" ? "is-risk" : undefined}>
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
      </div>
    </div>
  );
}

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

export function PublicLanding() {
  return (
    <PublicLandingMotion>
      <main className="landing-root">
        <header className="landing-header" data-landing-nav>
          <nav className="landing-nav" aria-label="Navegação principal">
            <Link href="/" aria-label="Keepr One — página inicial">
              <Logo size={25} variant="onLight" className="text-white" />
            </Link>

            <div className="landing-nav-links">
              <a href="#plataforma">Plataforma</a>
              <a href="#operacao">Como funciona</a>
              <a href="#visao">Sua visão</a>
            </div>

            <Link className="landing-nav-cta" href="/login">
              Entrar
              <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </header>

        <section className="landing-hero" data-hero>
          <div className="landing-hero-aura" data-hero-aura aria-hidden="true" />
          <div className="landing-grain" aria-hidden="true" />

          <div className="landing-wrap landing-hero-inner">
            <p className="landing-hero-kicker" data-hero-kicker>
              A central de operação do agente financeiro
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
              proteger a carteira e decidir sem trocar de contexto.
            </p>

            <div className="landing-hero-actions" data-hero-support>
              <a className="landing-button landing-button-primary" href="#plataforma">
                Conhecer a plataforma
                <span aria-hidden="true">↓</span>
              </a>
              <Link className="landing-button landing-button-ghost" href="/login">
                Entrar na Keepr One
                <span aria-hidden="true">↗</span>
              </Link>
            </div>

            <ProductStage />
          </div>
        </section>

        <div className="landing-marquee" aria-label={marqueeItems.join(", ")}>
          <div className="landing-marquee-track" data-landing-marquee>
            <MarqueeGroup />
            <MarqueeGroup hidden />
          </div>
        </div>

        <section className="landing-interest" id="plataforma">
          <div className="landing-wrap">
            <div className="landing-section-intro">
              <h2 data-copy-reveal>
                Menos troca de contexto.
                <br />
                Mais clareza para agir.
              </h2>
              <p data-copy-reveal>
                Sua operação já produz informação o dia inteiro. A Keepr One
                organiza essa informação em uma perspectiva que acompanha o
                ritmo real do agente.
              </p>
            </div>

            <div className="landing-bento">
              <article
                className="landing-bento-card landing-bento-main"
                data-image-reveal
              >
                <div className="landing-bento-copy">
                  <span>Visão operacional</span>
                  <h3>Uma operação. Um único contexto.</h3>
                  <p>
                    Casos, clientes, apólices, documentos, comissões e equipe
                    conectados pela mesma lógica de trabalho.
                  </p>
                </div>

                <div className="landing-flow" aria-hidden="true">
                  <div className="landing-flow-line" />
                  {[
                    ["01", "Novo caso", "Contexto registrado"],
                    ["02", "Requirement", "Pendência visível"],
                    ["03", "Apólice", "Carteira acompanhada"],
                    ["04", "Comissão", "Resultado entendido"],
                  ].map(([number, title, detail], index) => (
                    <div
                      className={index === 2 ? "is-current" : undefined}
                      key={number}
                    >
                      <span>{number}</span>
                      <b>{title}</b>
                      <small>{detail}</small>
                    </div>
                  ))}
                </div>

                <div className="landing-bento-foot">
                  <span>
                    <i />
                    Contexto preservado
                  </span>
                  <span>Do contato ao resultado</span>
                </div>
              </article>

              <article
                className="landing-bento-card landing-bento-queue"
                data-image-reveal
              >
                <div className="landing-bento-copy">
                  <span>Prioridade</span>
                  <h3>O dia começa pelo que importa.</h3>
                  <p>
                    A fila deixa claro o que pode destravar um caso ou proteger
                    a carteira.
                  </p>
                </div>
                <div className="landing-mini-queue" aria-hidden="true">
                  <span>
                    <b>02</b>
                    Apólices em risco
                    <i>Agora</i>
                  </span>
                  <span>
                    <b>03</b>
                    Follow-ups
                    <i>Hoje</i>
                  </span>
                  <span>
                    <b>01</b>
                    Revisão anual
                    <i>Próximo</i>
                  </span>
                </div>
              </article>

              <article
                className="landing-bento-card landing-bento-money"
                data-image-reveal
              >
                <div className="landing-bento-copy">
                  <span>Comissões</span>
                  <h3>O resultado deixa um rastro legível.</h3>
                  <p>
                    Veja o caminho entre valor esperado, pagamento e chargeback
                    antes de fechar o mês.
                  </p>
                </div>
                <div className="landing-money-visual" aria-hidden="true">
                  <div>
                    <span>Esperada</span>
                    <b>100%</b>
                  </div>
                  <i>
                    <span />
                  </i>
                  <div>
                    <span>Conciliada</span>
                    <b>76%</b>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="landing-journey" id="operacao">
          <div className="landing-grain" aria-hidden="true" />
          <div className="landing-wrap landing-journey-layout">
            <div className="landing-journey-intro">
              <span className="landing-section-index">01 — 05</span>
              <h2 data-copy-reveal>
                A operação não termina quando o cliente assina.
              </h2>
              <p data-copy-reveal>
                A Keepr One preserva o contexto entre cada etapa para que o
                próximo movimento não dependa da sua memória — nem de mais uma
                planilha.
              </p>
            </div>

            <div className="landing-journey-cards">
              {journey.map((step, index) => (
                <article
                  className="landing-journey-card"
                  data-journey-card
                  key={step.number}
                  style={{ "--stack-index": index } as CSSProperties}
                >
                  <div className="landing-journey-number">{step.number}</div>
                  <div className="landing-journey-copy">
                    <span>{step.eyebrow}</span>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                  <div className="landing-journey-signal">
                    <span>
                      <i />
                      {step.signal}
                    </span>
                    <b>{step.detail}</b>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-questions" id="visao">
          <div className="landing-wrap">
            <div className="landing-questions-heading">
              <span className="landing-section-index">Sua visão diária</span>
              <h2 data-copy-reveal>
                Abra a Keepr One.
                <br />
                Responda o que importa.
              </h2>
            </div>

            <div className="landing-question-list">
              {operationQuestions.map((item) => (
                <article key={item.number} data-copy-reveal>
                  <span>{item.number}</span>
                  <h3>{item.question}</h3>
                  <p>{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-final">
          <div className="landing-grain" aria-hidden="true" />
          <div className="landing-final-aura" aria-hidden="true" />
          <div className="landing-wrap landing-final-inner">
            <LogoMark size={48} />
            <h2 data-copy-reveal>
              Seu negócio já se move todos os dias.
              <br />
              Faça a operação aparecer.
            </h2>
            <p data-copy-reveal>
              Uma perspectiva completa para conduzir clientes, trabalho,
              carteira e resultado de ponta a ponta.
            </p>
            <div className="landing-final-actions" data-copy-reveal>
              <a className="landing-button landing-button-primary" href="#plataforma">
                Conhecer a plataforma
                <span aria-hidden="true">↑</span>
              </a>
              <Link className="landing-button landing-button-ghost" href="/login">
                Entrar na Keepr One
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
        </section>

        <footer className="landing-footer">
          <div className="landing-wrap landing-footer-inner">
            <div>
              <Logo size={25} variant="onLight" className="text-white" />
              <p>Uma perspectiva completa para agentes financeiros.</p>
            </div>
            <div className="landing-footer-links">
              <a href="#plataforma">Plataforma</a>
              <a href="#operacao">Como funciona</a>
              <a href="#visao">Sua visão</a>
              <Link href="/login">Entrar</Link>
            </div>
            <p>© 2026 Keepr One</p>
          </div>
        </footer>
      </main>
    </PublicLandingMotion>
  );
}
