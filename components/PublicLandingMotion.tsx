"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function PublicLandingMotion({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        const intro = gsap.timeline({
          defaults: { duration: 1, ease: "power3.out" },
        });

        intro
          .from("[data-landing-nav]", { y: -18, opacity: 0, duration: 0.7 })
          .from(
            "[data-hero-kicker]",
            { y: 18, opacity: 0, duration: 0.65 },
            "-=0.25",
          )
          .from(
            "[data-hero-line]",
            { yPercent: 115, rotate: 1.5, stagger: 0.1 },
            "-=0.45",
          )
          .from(
            "[data-hero-support]",
            { y: 22, opacity: 0, stagger: 0.08, duration: 0.75 },
            "-=0.55",
          )
          .from(
            "[data-product-stage]",
            { y: 80, scale: 0.93, opacity: 0, duration: 1.25 },
            "-=0.45",
          );

        const chartLine = scope.current?.querySelector<SVGPathElement>(
          "[data-chart-line]",
        );

        if (chartLine) {
          const lineLength = chartLine.getTotalLength();
          gsap.set(chartLine, {
            strokeDasharray: lineLength,
            strokeDashoffset: lineLength,
          });
          intro.to(
            chartLine,
            {
              strokeDashoffset: 0,
              duration: 1.45,
              ease: "power2.inOut",
            },
            "-=0.85",
          );
        }

        gsap.to("[data-landing-nav]", {
          backgroundColor: "rgba(5, 7, 6, 0.86)",
          borderColor: "rgba(255, 255, 255, 0.10)",
          ease: "none",
          scrollTrigger: {
            trigger: "[data-hero]",
            start: "top top",
            end: "+=120",
            scrub: true,
          },
        });

        gsap.to("[data-hero-aura]", {
          yPercent: 22,
          scale: 1.08,
          ease: "none",
          scrollTrigger: {
            trigger: "[data-hero]",
            start: "top top",
            end: "bottom top",
            scrub: 0.8,
          },
        });

        const marquee = scope.current?.querySelector<HTMLElement>(
          "[data-landing-marquee]",
        );

        if (marquee) {
          gsap.to(marquee, {
            xPercent: -50,
            duration: 30,
            repeat: -1,
            ease: "none",
          });
        }

        gsap.utils
          .toArray<HTMLElement>("[data-image-reveal]")
          .forEach((element) => {
            gsap.fromTo(
              element,
              { y: 70, scale: 0.91, opacity: 0.18 },
              {
                y: 0,
                scale: 1,
                opacity: 1,
                ease: "none",
                scrollTrigger: {
                  trigger: element,
                  start: "top 90%",
                  end: "top 48%",
                  scrub: 0.8,
                },
              },
            );
          });

        gsap.utils
          .toArray<HTMLElement>("[data-copy-reveal]")
          .forEach((element) => {
            gsap.from(element, {
              y: 34,
              opacity: 0,
              duration: 0.9,
              ease: "power3.out",
              scrollTrigger: {
                trigger: element,
                start: "top 86%",
                toggleActions: "play none none reverse",
              },
            });
          });
      });

      media.add(
        "(min-width: 768px) and (prefers-reduced-motion: no-preference)",
        () => {
          const cards = gsap.utils.toArray<HTMLElement>(
            "[data-journey-card]",
          );

          cards.forEach((card, index) => {
            gsap.fromTo(
              card,
              {
                y: 112,
                scale: 0.94,
                opacity: 0.18,
              },
              {
                y: 0,
                scale: 1,
                opacity: 1,
                ease: "none",
                scrollTrigger: {
                  trigger: card,
                  start: "top 94%",
                  end: "top 52%",
                  scrub: 0.7,
                  invalidateOnRefresh: true,
                },
              },
            );

            if (index < cards.length - 1) {
              gsap.to(card, {
                scale: 0.975,
                opacity: 0.64,
                ease: "none",
                scrollTrigger: {
                  trigger: cards[index + 1],
                  start: "top 76%",
                  end: "top 48%",
                  scrub: 0.65,
                  invalidateOnRefresh: true,
                },
              });
            }
          });
        },
      );

      let active = true;
      void document.fonts.ready.then(() => {
        if (active) ScrollTrigger.refresh();
      });

      return () => {
        active = false;
        media.revert();
      };
    },
    { scope },
  );

  return (
    <div ref={scope} className="w-full max-w-full">
      {children}
    </div>
  );
}
