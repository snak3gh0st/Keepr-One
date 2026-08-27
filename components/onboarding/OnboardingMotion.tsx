"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function OnboardingMotion({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-onboarding-reveal]", {
          y: 24,
          opacity: 0,
          duration: 0.82,
          stagger: 0.075,
          ease: "power3.out",
        });

        const marquee = scope.current?.querySelector<HTMLElement>(
          "[data-onboarding-marquee]",
        );
        if (marquee) {
          gsap.to(marquee, {
            xPercent: -50,
            duration: 34,
            repeat: -1,
            ease: "none",
          });
        }
      });

      media.add(
        "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
        () => {
          const tour = scope.current?.querySelector<HTMLElement>(
            "[data-onboarding-tour]",
          );
          const heading = scope.current?.querySelector<HTMLElement>(
            "[data-onboarding-tour-heading]",
          );

          if (tour && heading) {
            ScrollTrigger.create({
              trigger: tour,
              start: "top top+=112",
              end: "bottom bottom-=120",
              pin: heading,
              pinSpacing: false,
              invalidateOnRefresh: true,
            });
          }

          const stackCards = gsap.utils.toArray<HTMLElement>(
            "[data-onboarding-stack-card]",
          );
          stackCards.forEach((card, index) => {
            gsap.fromTo(
              card,
              {
                y: 76 + index * 18,
                scale: 0.94,
                opacity: 0.42,
              },
              {
                y: index * 10,
                scale: 1 - index * 0.012,
                opacity: 1,
                ease: "none",
                scrollTrigger: {
                  trigger: card,
                  start: "top 94%",
                  end: "top 62%",
                  scrub: 0.55,
                },
              },
            );
          });
        },
      );

      return () => media.revert();
    },
    { scope },
  );

  return (
    <div ref={scope} className="onboarding-motion-root w-full max-w-full overflow-x-hidden">
      {children}
    </div>
  );
}
