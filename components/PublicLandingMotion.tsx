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
            "[data-hero-audience] > i",
            { scaleX: 0, duration: 0.72, ease: "power3.out" },
            "-=0.38",
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

        const landingBrandRoot =
          scope.current?.querySelector<HTMLElement>(
            "[data-landing-brand] [data-logo-root]",
          );
        const landingBrandWordmark =
          scope.current?.querySelector<HTMLElement>(
            "[data-landing-brand] [data-logo-wordmark]",
          );

        if (landingBrandRoot && landingBrandWordmark) {
          gsap
            .timeline({
              scrollTrigger: {
                trigger: "[data-hero]",
                start: "top top",
                end: "+=180",
                scrub: 0.55,
                invalidateOnRefresh: true,
              },
            })
            .to(
              landingBrandWordmark,
              {
                width: 0,
                x: -10,
                scaleX: 0.88,
                opacity: 0,
                ease: "none",
              },
              0,
            )
            .to(
              landingBrandRoot,
              {
                columnGap: 0,
                ease: "none",
              },
              0,
            );
        }

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

        const footerMarquee = scope.current?.querySelector<HTMLElement>(
          "[data-footer-marquee]",
        );

        if (footerMarquee) {
          gsap.to(footerMarquee, {
            xPercent: -50,
            duration: 28,
            repeat: -1,
            ease: "none",
          });
        }

        const pricingMarquee = scope.current?.querySelector<HTMLElement>(
          "[data-pricing-marquee]",
        );

        if (pricingMarquee) {
          gsap.to(pricingMarquee, {
            xPercent: -50,
            duration: 42,
            repeat: -1,
            ease: "none",
          });
        }

        const pricingWords = gsap.utils.toArray<HTMLElement>(
          "[data-pricing-word]",
        );

        if (pricingWords.length > 0) {
          gsap.fromTo(
            pricingWords,
            { y: 12, opacity: 0.12 },
            {
              y: 0,
              opacity: 1,
              stagger: 0.08,
              ease: "none",
              scrollTrigger: {
                trigger: ".landing-pricing-heading",
                start: "top 82%",
                end: "bottom 48%",
                scrub: 0.7,
              },
            },
          );
        }

        gsap.utils
          .toArray<HTMLElement>("[data-pricing-card]")
          .forEach((card, index) => {
            gsap.fromTo(
              card,
              {
                y: 58 + index * 12,
                scale: 0.94,
                opacity: 0.24,
              },
              {
                y: 0,
                scale: 1,
                opacity: 1,
                ease: "none",
                scrollTrigger: {
                  trigger: card,
                  start: "top 93%",
                  end: "top 64%",
                  scrub: 0.65,
                },
              },
            );
          });

        gsap.from("[data-footer-panel]", {
          y: 42,
          scale: 0.975,
          opacity: 0,
          transformOrigin: "50% 100%",
          duration: 0.9,
          stagger: 0.09,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ".landing-footer-inner",
            start: "top 88%",
            toggleActions: "play none none reverse",
          },
        });

        gsap.from("[data-footer-mark]", {
          scale: 0.82,
          opacity: 0.2,
          duration: 1.1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ".landing-footer-heading",
            start: "top 88%",
            toggleActions: "play none none reverse",
          },
        });

        gsap.utils
          .toArray<HTMLElement>("[data-image-reveal]")
          .forEach((element) => {
            gsap.fromTo(
              element,
              { y: 30, scale: 0.98, opacity: 0.68 },
              {
                y: 0,
                scale: 1,
                opacity: 1,
                ease: "none",
                scrollTrigger: {
                  trigger: element,
                  start: "top 92%",
                  end: "top 67%",
                  scrub: 0.6,
                },
              },
            );
          });

        gsap.from("[data-flow-step]", {
          y: 12,
          opacity: 0,
          duration: 0.55,
          stagger: 0.08,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ".landing-context-snapshot",
            start: "top 78%",
            toggleActions: "play none none reverse",
          },
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

        gsap.from("[data-journey-panel]", {
          scale: 0.965,
          opacity: 0,
          transformOrigin: "50% 100%",
          duration: 1,
          stagger: 0.14,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ".landing-feature-grid",
            start: "top 82%",
            toggleActions: "play none none reverse",
          },
        });

        gsap.from("[data-crm-detail]", {
          x: 14,
          opacity: 0,
          duration: 0.58,
          stagger: 0.08,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ".landing-journey-summary",
            start: "top 84%",
            toggleActions: "play none none reverse",
          },
        });

        gsap.from("[data-journey-cue]", {
          x: -16,
          opacity: 0,
          duration: 0.55,
          stagger: 0.08,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ".landing-priority-window",
            start: "top 76%",
            toggleActions: "play none none reverse",
          },
        });

        gsap.from("[data-operation-stage]", {
          y: 12,
          opacity: 0,
          duration: 0.5,
          stagger: 0.07,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ".landing-operation-rail",
            start: "top 90%",
            toggleActions: "play none none reverse",
          },
        });

        const journeyChartLine =
          scope.current?.querySelector<SVGPathElement>(
            "[data-journey-chart-line]",
          );
        const journeyChartArea =
          scope.current?.querySelector<SVGPathElement>(
            "[data-journey-chart-area]",
          );
        const journeyChartPoints = gsap.utils.toArray<SVGCircleElement>(
          "[data-journey-chart-point]",
        );
        const journeyChartValue =
          scope.current?.querySelector<HTMLElement>(
            "[data-journey-chart-value]",
          );

        if (journeyChartLine && journeyChartArea && journeyChartValue) {
          const lineLength = journeyChartLine.getTotalLength();
          const chartCounter = { value: 0 };

          gsap.set(journeyChartLine, {
            strokeDasharray: lineLength,
            strokeDashoffset: lineLength,
          });
          gsap.set(journeyChartArea!, { opacity: 0, y: 14 });
          gsap.set(journeyChartPoints, {
            opacity: 0,
            scale: 0,
            transformOrigin: "center",
          });
          journeyChartValue.textContent = "0%";

          const chartTimeline = gsap.timeline({
            scrollTrigger: {
              trigger: ".landing-performance-window",
              start: "top 78%",
              toggleActions: "play none none reverse",
            },
          });

          chartTimeline
            .to(journeyChartLine, {
              strokeDashoffset: 0,
              duration: 1.45,
              ease: "power2.inOut",
            })
            .to(
              journeyChartArea!,
              { opacity: 1, y: 0, duration: 0.85, ease: "power2.out" },
              "-=0.95",
            )
            .to(
              journeyChartPoints,
              {
                opacity: 1,
                scale: 1,
                duration: 0.36,
                stagger: 0.08,
                ease: "back.out(2)",
              },
              "-=0.58",
            )
            .to(
              chartCounter,
              {
                value: 76,
                duration: 1.2,
                ease: "power2.out",
                onUpdate: () => {
                  journeyChartValue.textContent = `${Math.round(chartCounter.value)}%`;
                },
              },
              0.12,
            );
        }

        gsap.fromTo(
          "[data-vision-shell]",
          { y: 48, scale: 0.92, opacity: 0.34 },
          {
            y: 0,
            scale: 1,
            opacity: 1,
            ease: "none",
            scrollTrigger: {
              trigger: "[data-vision-shell]",
              start: "top 92%",
              end: "top 54%",
              scrub: 0.7,
            },
          },
        );

        const finalStage =
          scope.current?.querySelector<HTMLElement>("[data-final-stage]");

        if (finalStage) {
          gsap
            .timeline({
              scrollTrigger: {
                trigger: ".landing-final",
                start: "top 88%",
                end: "bottom 18%",
                scrub: 0.7,
              },
            })
            .fromTo(
              finalStage,
              { y: 64, scale: 0.86, opacity: 0.22 },
              {
                y: 0,
                scale: 1,
                opacity: 1,
                duration: 0.55,
                ease: "none",
              },
            )
            .to(finalStage, {
              y: -18,
              scale: 0.965,
              opacity: 0.58,
              duration: 0.45,
              ease: "none",
            });
        }

        gsap.from("[data-final-card]", {
          y: 96,
          scale: 0.88,
          opacity: 0,
          transformOrigin: "50% 100%",
          duration: 0.9,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ".landing-final-demo",
            start: "top 78%",
            toggleActions: "play none none reverse",
          },
        });
      });

      media.add(
        "(min-width: 960px) and (prefers-reduced-motion: no-preference)",
        () => {
          const visionHeading = scope.current?.querySelector<HTMLElement>(
            "[data-vision-heading]",
          );

          if (!visionHeading) return;

          ScrollTrigger.create({
            trigger: ".landing-questions",
            start: "top 15%",
            end: "bottom 55%",
            pin: visionHeading,
            pinSpacing: false,
            anticipatePin: 1,
            invalidateOnRefresh: true,
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
