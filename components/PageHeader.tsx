"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { PageTitle } from "@/components/PageTitle";
import { useI18n } from "@/components/i18n/LanguageProvider";

function HeaderSignalGroup({ hidden = false }: { hidden?: boolean }) {
  const { copy } = useI18n();
  const signals = [
    copy("Visão atualizada", "Updated view"),
    copy("Próxima ação", "Next action"),
    copy("Dados organizados", "Organized data"),
    copy("Operação conectada", "Connected operation"),
  ];

  return (
    <div className="module-header-signal-group" aria-hidden={hidden || undefined}>
      {signals.map((signal) => (
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
  variant,
}: {
  title: string;
  eyebrow?: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  variant?: "black-achievement";
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

        if (variant === "black-achievement") {
          gsap.fromTo(
            "[data-module-black-wash]",
            { scaleX: 0.86, opacity: 0 },
            {
              scaleX: 1,
              opacity: 1,
              duration: 1.05,
              ease: "power3.out",
              clearProps: "transform,opacity",
            },
          );
        }

        return () => observer.disconnect();
      }
    },
    { scope: root },
  );

  return (
    <header
      ref={root}
      className="module-header keepr-noise"
      data-variant={variant}
    >
      {variant === "black-achievement" ? (
        <span
          className="module-header-black-wash"
          data-module-black-wash
          aria-hidden="true"
        />
      ) : null}
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
