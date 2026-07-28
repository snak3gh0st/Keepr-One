"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { PageTitle } from "@/components/PageTitle";

const HEADER_SIGNALS = [
  "Visão atualizada",
  "Próxima ação",
  "Dados organizados",
  "Operação conectada",
];

function HeaderSignalGroup({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="module-header-signal-group" aria-hidden={hidden || undefined}>
      {HEADER_SIGNALS.map((signal) => (
        <span key={signal}>
          {signal}
          <i />
        </span>
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  eyebrow,
  description,
  children,
}: {
  title: string
  eyebrow?: string
  description?: React.ReactNode
  children?: React.ReactNode
}) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const items = gsap.utils.toArray("[data-module-header-item]");
      const track = gsap.utils.toArray("[data-module-header-track]");

      if (items.length > 0) {
        gsap.from(items, {
          y: 22,
          scale: 0.985,
          opacity: 0,
          duration: 0.72,
          stagger: 0.07,
          ease: "power3.out",
        });
      }

      if (track.length > 0) {
        const marquee = gsap.to(track, {
          xPercent: -50,
          duration: 26,
          ease: "none",
          repeat: -1,
          paused: true,
        });

        const observer = new IntersectionObserver(([entry]) => {
          marquee.paused(!entry.isIntersecting);
        });

        if (root.current) observer.observe(root.current);
        return () => observer.disconnect();
      }
    },
    { scope: root },
  );

  return (
    <header ref={root} className="module-header keepr-noise">
      <div className="module-header-main">
        <div className="module-header-title" data-module-header-item>
          {eyebrow && <p>{eyebrow}</p>}
          <PageTitle className="module-page-title">
            {title}
            <span className="module-title-flow" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </PageTitle>
        </div>

        <div className="module-header-side">
          {description && (
            <div className="module-header-description" data-module-header-item>
              {description}
            </div>
          )}
          {children && (
            <div className="module-header-actions" data-module-header-item>
              {children}
            </div>
          )}
        </div>
      </div>

      <div className="module-header-signals" aria-hidden="true">
        <div className="module-header-signal-track" data-module-header-track>
          <HeaderSignalGroup />
          <HeaderSignalGroup hidden />
        </div>
      </div>
    </header>
  );
}
