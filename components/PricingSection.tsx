"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { INVITED_AGENT_MONTHLY_PRICE_CENTS } from "@/lib/plans";

type BillingCycle = "monthly" | "annual";

const invitedAgentMonthlyAmount = (INVITED_AGENT_MONTHLY_PRICE_CENTS / 100)
  .toFixed(2)
  .replace(".", ",");

const pricingSignals = [
  "Carteira individual",
  "Gestão de equipe",
  "Ranking de produção",
  "Progresso Black Jacket",
  "Agentes convidados",
];

const prices = {
  agent: {
    monthly: {
      amount: "59,90",
      suffix: "/mês",
      support: "Plano anual por US$ 598,80",
      saving: "Economize 2 meses escolhendo o anual",
    },
    annual: {
      amount: "49,90",
      suffix: "/mês",
      support: "Cobrado US$ 598,80 uma vez ao ano",
      saving: "US$ 120 de economia",
    },
  },
  agency: {
    monthly: {
      amount: "99,90",
      suffix: "/mês",
      support: "Plano anual por US$ 958,80",
      saving: "Economize US$ 240,00 no anual",
    },
    annual: {
      amount: "79,90",
      suffix: "/mês",
      support: "Cobrado US$ 958,80 uma vez ao ano",
      saving: "US$ 240,00 de economia (20%)",
    },
  },
} as const;

const agentFeatures = [
  "Seus dados, clientes e atendimentos organizados",
  "Controle da sua carteira e das suas apólices",
  "Leitura individual da sua produção",
  "Seu caminho até o Black Jacket",
];

const agencyFeatures = [
  "Convites para agentes da sua equipe",
  "Produção individual e consolidada da agência",
  "Visão para orientar o desenvolvimento de cada agente",
  "Ranking de produção visível para toda a equipe",
  "Caminho do time até o Black Jacket",
];

function PricingSignalGroup({ hidden = false }: { hidden?: boolean }) {
  return (
    <div
      className="landing-pricing-signal-group"
      aria-hidden={hidden || undefined}
    >
      {pricingSignals.map((signal) => (
        <span key={signal}>
          {signal}
          <i />
        </span>
      ))}
    </div>
  );
}

function PlanPrice({
  amount,
  suffix,
  support,
  saving,
}: {
  amount: string;
  suffix: string;
  support: string;
  saving: string;
}) {
  return (
    <div
      className="landing-plan-price"
      data-plan-price
      aria-live="polite"
    >
      <div>
        <span>US$</span>
        <strong>{amount}</strong>
        <small>{suffix}</small>
      </div>
      <p>{support}</p>
      <b>{saving}</b>
    </div>
  );
}

export function PricingSection() {
  const pricingScope = useRef<HTMLElement>(null);
  const [billingCycle, setBillingCycle] =
    useState<BillingCycle>("monthly");
  const agentPrice = prices.agent[billingCycle];
  const agencyPrice = prices.agency[billingCycle];
  const agentHref = `/login?plan=agent&billing=${billingCycle}`;
  const agencyHref = `/login?plan=agency&billing=${billingCycle}`;

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.fromTo(
        "[data-plan-price] > *",
        { y: 7, opacity: 0.35 },
        {
          y: 0,
          opacity: 1,
          duration: 0.32,
          stagger: 0.035,
          ease: "power3.out",
          overwrite: "auto",
        },
      );
    },
    {
      scope: pricingScope,
      dependencies: [billingCycle],
      revertOnUpdate: true,
    },
  );

  return (
    <section
      ref={pricingScope}
      className="landing-pricing landing-dark-texture"
      id="planos"
      aria-labelledby="landing-pricing-title"
    >
      <div className="landing-grain" aria-hidden="true" />
      <div className="landing-pricing-aura" aria-hidden="true" />

      <div className="landing-wrap landing-pricing-inner">
        <header className="landing-pricing-heading">
          <div>
            <span className="landing-section-index">
              Escolha como você quer operar
            </span>
            <h2 id="landing-pricing-title">
              <span data-pricing-word>Um</span>{" "}
              <span data-pricing-word>plano</span>{" "}
              <span data-pricing-word>para</span>{" "}
              <span data-pricing-word>cada</span>{" "}
              <span data-pricing-word>forma</span>{" "}
              <span data-pricing-word>de</span>{" "}
              <span data-pricing-word>crescer.</span>
            </h2>
          </div>

          <div className="landing-pricing-intro">
            <p data-copy-reveal>
              Cuide da sua própria carteira ou lidere a agência com uma visão
              clara da produção e do progresso do time.
            </p>

            <div
              className={`landing-billing-toggle${
                billingCycle === "annual" ? " is-annual" : ""
              }`}
              role="group"
              aria-label="Período de cobrança"
            >
              <button
                type="button"
                className={billingCycle === "monthly" ? "is-active" : undefined}
                aria-pressed={billingCycle === "monthly"}
                onClick={() => setBillingCycle("monthly")}
              >
                Mensal
              </button>
              <button
                type="button"
                className={billingCycle === "annual" ? "is-active" : undefined}
                aria-pressed={billingCycle === "annual"}
                onClick={() => setBillingCycle("annual")}
              >
                Anual
                <span>Economize 2 meses</span>
              </button>
            </div>
          </div>
        </header>

        <div className="landing-pricing-grid">
          <article
            className="landing-pricing-card landing-pricing-card-agent"
            data-pricing-card
          >
            <div className="landing-plan-head">
              <div className="landing-plan-meta">
                <span>Plano Agente</span>
                <b>Uso individual</b>
              </div>
              <h3>Sua operação, seu progresso.</h3>
              <p>
                Para o agente que quer organizar a própria carteira e enxergar
                com clareza a próxima conquista.
              </p>
            </div>

            <PlanPrice {...agentPrice} />

            <ul
              className="landing-plan-features landing-plan-features-agent"
              aria-label="Recursos do Plano Agente"
            >
              {agentFeatures.map((feature) => (
                <li key={feature}>
                  <i aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>

            <Link className="landing-plan-cta" href={agentHref}>
              Escolher Plano Agente
              <span aria-hidden="true">↗</span>
            </Link>
          </article>

          <article
            className="landing-pricing-card landing-pricing-card-agency"
            data-pricing-card
          >
            <div className="landing-plan-head">
              <div className="landing-plan-meta">
                <span>Plano Agência</span>
                <b>Para equipes</b>
              </div>
              <h3>Mais visão para desenvolver todo o time.</h3>
              <p>
                Para quem lidera agentes, acompanha a produção e quer transformar
                desempenho em direção prática.
              </p>
            </div>

            <PlanPrice {...agencyPrice} />

            <div className="landing-plan-member-rate">
              <div>
                <span>Cada agente convidado</span>
                <p>Assinatura individual vinculada à agência</p>
              </div>
              <strong>
                US$ {invitedAgentMonthlyAmount}
                <small>por usuário / mês</small>
              </strong>
            </div>

            <ul
              className="landing-plan-features landing-plan-features-agency"
              aria-label="Recursos do Plano Agência"
            >
              {agencyFeatures.map((feature) => (
                <li key={feature}>
                  <i aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>

            <Link className="landing-plan-cta" href={agencyHref}>
              Escolher Plano Agência
              <span aria-hidden="true">↗</span>
            </Link>
          </article>
        </div>

        <p className="landing-pricing-note">
          O Plano Agência inclui o painel de gestão. Cada agente convidado
          assina sua conta vinculada separadamente por US$ {invitedAgentMonthlyAmount} ao mês.
        </p>
      </div>

      <div
        className="landing-pricing-signals"
        aria-label={pricingSignals.join(", ")}
      >
        <div className="landing-pricing-signal-track" data-pricing-marquee>
          <PricingSignalGroup />
          <PricingSignalGroup hidden />
        </div>
      </div>
    </section>
  );
}
