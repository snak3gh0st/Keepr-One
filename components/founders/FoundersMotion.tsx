"use client";

import { type ReactNode, useRef } from "react";
import { usePathname } from "next/navigation";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function FoundersMotion({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const scope = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;

      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        const titleLines = root.querySelectorAll<HTMLElement>(
          "[data-founders-title-line]",
        );
        const intro = root.querySelectorAll<HTMLElement>(
          "[data-founders-intro]",
        );
        const panels = root.querySelectorAll<HTMLElement>(
          "[data-founders-panel]",
        );
        const visuals = root.querySelectorAll<HTMLElement>(
          "[data-founders-visual]",
        );
        const entrance = gsap.timeline({ defaults: { ease: "power3.out" } });

        if (titleLines.length) {
          entrance.fromTo(
            titleLines,
            { y: 16, opacity: 0.7 },
            {
              y: 0,
              opacity: 1,
              duration: 0.7,
              stagger: { amount: 0.08 },
              clearProps: "transform,opacity",
            },
            0,
          );
        }

        if (intro.length) {
          entrance.fromTo(
            intro,
            { y: 10, opacity: 0.7 },
            {
              y: 0,
              opacity: 1,
              duration: 0.62,
              stagger: { amount: 0.06 },
              clearProps: "transform,opacity",
            },
            0.06,
          );
        }

        if (panels.length) {
          entrance.fromTo(
            panels,
            { y: 12, opacity: 0.8 },
            {
              y: 0,
              opacity: 1,
              duration: 0.68,
              clearProps: "transform,opacity",
            },
            0.1,
          );
        }

        if (visuals.length) {
          entrance.fromTo(
            visuals,
            { y: 8, opacity: 0.75 },
            {
              y: 0,
              opacity: 1,
              duration: 0.72,
              clearProps: "transform,opacity",
            },
            0.1,
          );
        }
      });

      media.add(
        "(min-width: 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
        () => {
          const signals = root.querySelectorAll<HTMLElement>(
            "[data-founders-signal]",
          );

          signals.forEach((signal) => {
            gsap.fromTo(
              signal,
              { scale: 0.92 },
              {
                scale: 1,
                duration: 0.8,
                ease: "power3.out",
                clearProps: "transform",
                scrollTrigger: {
                  trigger: signal,
                  start: "top 95%",
                  once: true,
                },
              },
            );

            gsap.fromTo(
              signal,
              { opacity: 1 },
              {
                opacity: 0.4,
                ease: "none",
                scrollTrigger: {
                  trigger: signal,
                  start: "bottom 20%",
                  end: "bottom top",
                  scrub: 0.4,
                },
              },
            );
          });
        },
      );

      return () => media.revert();
    },
    { scope, dependencies: [pathname], revertOnUpdate: true },
  );

  return (
    <main ref={scope} className={className} lang="pt-BR">
      {children}
    </main>
  );
}
