"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function KeeprDashboardMotion({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-hero-reveal]", {
          y: 26,
          opacity: 0,
          duration: 0.9,
          stagger: 0.08,
          ease: "power3.out",
        });

        const words = gsap.utils.toArray<HTMLElement>("[data-reveal-word]");
        if (words.length > 0) {
          gsap.fromTo(
            words,
            { opacity: 0.18 },
            {
              opacity: 1,
              stagger: 0.025,
              ease: "none",
              scrollTrigger: {
                trigger: "[data-intro-copy]",
                start: "top 88%",
                end: "bottom 42%",
                scrub: 0.45,
              },
            },
          );
        }

        const stackCards = gsap.utils.toArray<HTMLElement>("[data-stack-card]");
        stackCards.forEach((card, index) => {
          gsap.fromTo(
            card,
            {
              y: 58 + index * 14,
              scale: 0.965,
              opacity: 0.55,
            },
            {
              y: 0,
              scale: 1,
              opacity: 1,
              ease: "none",
              scrollTrigger: {
                trigger: card,
                start: "top 96%",
                end: "top 68%",
                scrub: 0.55,
              },
            },
          );
        });

        const marquee = scope.current?.querySelector<HTMLElement>(".keepr-marquee-track");
        if (marquee) {
          gsap.to(marquee, {
            xPercent: -50,
            duration: 26,
            repeat: -1,
            ease: "none",
          });
        }
      });

      return () => media.revert();
    },
    { scope },
  );

  return (
    <div ref={scope} className="w-full max-w-full overflow-x-hidden">
      {children}
    </div>
  );
}
