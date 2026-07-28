"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

const dailyViews = [
  {
    id: "priorities",
    label: "Prioridades",
    question: "O que pede atenção agora?",
    module: "Sua fila",
    title: "Duas ações protegem sua carteira hoje.",
    body: "A Keepr One organiza urgência, impacto e prazo para que o dia comece pelo que realmente move a operação.",
    action: "Comece por Apólices em risco",
    signals: [
      {
        value: "02",
        label: "Apólices em risco",
        detail: "Revisar agora",
        tone: "risk",
      },
      {
        value: "03",
        label: "Follow-ups",
        detail: "Ainda hoje",
      },
      {
        value: "01",
        label: "Revisão anual",
        detail: "Próximos 3 dias",
      },
    ],
  },
  {
    id: "cases",
    label: "Casos",
    question: "O que avançou desde ontem?",
    module: "Casos em movimento",
    title: "Três casos ganharam um próximo passo.",
    body: "Mudanças de status, documentos e retornos aparecem em uma única leitura, sem reconstruir o histórico.",
    action: "Continue por Renovação de carteira",
    signals: [
      {
        value: "MC",
        label: "Renovação de carteira",
        detail: "Documentos recebidos",
        tone: "positive",
      },
      {
        value: "AL",
        label: "Proteção empresarial",
        detail: "Em análise",
      },
      {
        value: "RS",
        label: "Seguro individual",
        detail: "Proposta enviada",
      },
    ],
  },
  {
    id: "commissions",
    label: "Comissões",
    question: "O que já virou resultado?",
    module: "Conciliação mensal",
    title: "76% do esperado já está conciliado.",
    body: "O esperado, o pago e o que ainda está em validação permanecem conectados à origem de cada comissão.",
    action: "Revise os 24% ainda em validação",
    signals: [
      {
        value: "100%",
        label: "Esperada",
        detail: "Base do período",
      },
      {
        value: "76%",
        label: "Conciliada",
        detail: "Resultado confirmado",
        tone: "positive",
      },
      {
        value: "24%",
        label: "Em validação",
        detail: "Pede conferência",
        tone: "warning",
      },
    ],
  },
  {
    id: "portfolio",
    label: "Carteira",
    question: "Onde existe risco de perda?",
    module: "Saúde da carteira",
    title: "Duas apólices pedem cuidado antes da renovação.",
    body: "Vencimentos, revisões e sinais de risco surgem cedo o bastante para proteger o relacionamento e a receita.",
    action: "Antecipe a revisão mais próxima",
    signals: [
      {
        value: "07d",
        label: "Proteção familiar",
        detail: "Renovação próxima",
        tone: "warning",
      },
      {
        value: "12d",
        label: "Seguro empresarial",
        detail: "Revisão pendente",
        tone: "risk",
      },
      {
        value: "28d",
        label: "Vida individual",
        detail: "Carteira saudável",
        tone: "positive",
      },
    ],
  },
];

export function DailyVisionTabs() {
  const [activeIndex, setActiveIndex] = useState(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const activeView = dailyViews[activeIndex];

  useGSAP(
    () => {
      const panel = panelRefs.current[activeIndex];

      if (
        !panel ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      gsap.fromTo(
        panel,
        { y: 14, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.38, ease: "power3.out" },
      );
      gsap.fromTo(
        panel.querySelectorAll("[data-vision-signal]"),
        { y: 10, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.34,
          stagger: 0.055,
          ease: "power3.out",
        },
      );
    },
    {
      dependencies: [activeIndex],
      scope: shellRef,
      revertOnUpdate: true,
    },
  );

  function moveFocus(index: number) {
    setActiveIndex(index);
    requestAnimationFrame(() => {
      shellRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-vision-tab="${dailyViews[index].id}"]`,
        )
        ?.focus();
    });
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | undefined;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (index + 1) % dailyViews.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (index - 1 + dailyViews.length) % dailyViews.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = dailyViews.length - 1;
    }

    if (nextIndex !== undefined) {
      event.preventDefault();
      moveFocus(nextIndex);
    }
  }

  return (
    <div className="landing-vision-shell" data-vision-shell ref={shellRef}>
      <div
        aria-label="Escolha uma visão da operação"
        className="landing-vision-tabs"
        role="tablist"
      >
        <div className="landing-vision-tabs-head">
          <span>Visão de hoje</span>
          <b>
            <i />
            Ao vivo
          </b>
        </div>

        {dailyViews.map((view, index) => {
          const isActive = index === activeIndex;

          return (
            <button
              aria-controls={`landing-vision-panel-${view.id}`}
              aria-selected={isActive}
              className={isActive ? "is-active" : undefined}
              data-vision-tab={view.id}
              id={`landing-vision-tab-${view.id}`}
              key={view.id}
              onClick={() => setActiveIndex(index)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              type="button"
            >
              <span>{view.label}</span>
              <b>{view.question}</b>
              <i aria-hidden="true">→</i>
            </button>
          );
        })}
      </div>

      <div className="landing-vision-stage">
        <div className="landing-vision-stage-topbar">
          <span>
            <i />
            {activeView.module}
          </span>
          <b>Atualizada agora</b>
        </div>

        {dailyViews.map((view, index) => (
          <div
            aria-labelledby={`landing-vision-tab-${view.id}`}
            className="landing-vision-panel"
            hidden={index !== activeIndex}
            id={`landing-vision-panel-${view.id}`}
            key={view.id}
            ref={(element) => {
              panelRefs.current[index] = element;
            }}
            role="tabpanel"
            tabIndex={0}
          >
            <span>{view.module}</span>
            <h3>{view.title}</h3>
            <p>{view.body}</p>

            <div className="landing-vision-signals">
              {view.signals.map((signal) => (
                <article
                  className={signal.tone ? `is-${signal.tone}` : undefined}
                  data-vision-signal
                  key={signal.label}
                >
                  <strong>{signal.value}</strong>
                  <span>
                    <b>{signal.label}</b>
                    <small>{signal.detail}</small>
                  </span>
                </article>
              ))}
            </div>

            <div className="landing-vision-next">
              <span>
                <i />
                Próxima ação
              </span>
              <b>{view.action}</b>
            </div>
          </div>
        ))}

        <Link className="landing-vision-link" href="/login">
          Abrir visão completa
          <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </div>
  );
}
