"use client";

import { useState } from "react";
import Link from "next/link";

export type OperationSignal = {
  title: string;
  description: string;
  action: string;
  href: string;
  tone: "mint" | "amber" | "violet";
};

const toneClasses: Record<OperationSignal["tone"], string> = {
  mint: "from-[oklch(0.84_0.13_151)] to-[oklch(0.65_0.16_153)] text-rail-strong",
  amber: "from-[oklch(0.9_0.11_81)] to-[oklch(0.73_0.15_72)] text-rail-strong",
  violet: "from-[oklch(0.78_0.11_285)] to-[oklch(0.61_0.17_286)] text-paper",
};

export function OperationSignals({ signals }: { signals: OperationSignal[] }) {
  const [active, setActive] = useState(0);
  if (signals.length === 0) return null;
  const signal = signals[active];

  function move(direction: -1 | 1) {
    setActive((current) => (current + direction + signals.length) % signals.length);
  }

  return (
    <section
      aria-labelledby="operation-signals-title"
      className="relative overflow-hidden rounded-[28px] bg-rail-strong text-paper shadow-[var(--shadow-overlay)]"
      data-stack-card
    >
      <div className="grid min-h-[360px] lg:grid-cols-[minmax(0,0.78fr)_minmax(340px,1.22fr)]">
        <div className="flex flex-col justify-between border-b border-white/10 p-7 sm:p-9 lg:border-b-0 lg:border-r">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/45">
              Keepr Signals
            </p>
            <h2
              id="operation-signals-title"
              className="mt-5 max-w-lg text-3xl font-medium tracking-[-0.045em] sm:text-4xl"
            >
              Decisões melhores começam com clareza.
            </h2>
          </div>
          <div className="mt-10 flex items-center gap-2">
            <button
              type="button"
              onClick={() => move(-1)}
              aria-label="Insight anterior"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-paper transition-colors hover:bg-white hover:text-rail-strong"
            >
              <ArrowIcon direction="left" />
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              aria-label="Próximo insight"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-paper transition-colors hover:bg-white hover:text-rail-strong"
            >
              <ArrowIcon direction="right" />
            </button>
            <span className="ml-3 font-mono text-xs text-paper/45">
              {String(active + 1).padStart(2, "0")} / {String(signals.length).padStart(2, "0")}
            </span>
          </div>
        </div>

        <div className="relative min-h-[320px] overflow-hidden p-4 sm:p-6" aria-live="polite">
          <div
            key={signal.title}
            className={`group relative flex h-full min-h-[300px] flex-col justify-between overflow-hidden rounded-[22px] bg-gradient-to-br p-7 transition-transform duration-700 ease-out hover:scale-[1.015] sm:p-9 ${toneClasses[signal.tone]}`}
          >
            <div
              aria-hidden
              className="absolute -right-16 -top-20 h-56 w-56 rounded-full border-[34px] border-current opacity-10 transition-transform duration-700 ease-out group-hover:scale-110"
            />
            <div className="relative max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-60">
                Próximo movimento
              </p>
              <h3 className="mt-5 max-w-2xl text-3xl font-medium leading-[1.05] tracking-[-0.045em] sm:text-4xl">
                {signal.title}
              </h3>
              <p className="mt-5 max-w-xl text-sm leading-6 opacity-[0.72] sm:text-base">
                {signal.description}
              </p>
            </div>
            <Link
              href={signal.href}
              className="relative mt-9 inline-flex w-fit items-center gap-2 rounded-full bg-rail-strong px-5 py-3 text-sm font-semibold text-paper transition-transform duration-300 hover:translate-x-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper"
            >
              {signal.action}
              <ArrowIcon direction="right" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={direction === "left" ? "rotate-180" : ""}
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
