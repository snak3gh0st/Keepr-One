"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function OnboardingMotion({
  children,
  step,
}: {
  children: React.ReactNode;
  step: string;
}) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        const root = scope.current;
        const stepCard = root?.querySelector<HTMLElement>("[data-onboarding-step-card]");
        const assistant = root?.querySelector<HTMLElement>("[data-onboarding-assistant]");
        const substeps = root
          ? Array.from(root.querySelectorAll<HTMLElement>(".onboarding-kbot-substeps > li"))
          : [];
        const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
        if (stepCard) {
          timeline.fromTo(
            stepCard,
            { y: 24, scale: 0.985, opacity: 0 },
            { y: 0, scale: 1, opacity: 1, duration: 0.46, clearProps: "transform,opacity" },
          );
        }
        if (assistant) {
          timeline.fromTo(
            assistant,
            { y: 14, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.38, clearProps: "transform,opacity" },
            0.08,
          );
        }
        if (substeps.length > 0) {
          timeline.fromTo(
            substeps,
            { y: 12, scale: 0.97, opacity: 0 },
            { y: 0, scale: 1, opacity: 1, duration: 0.32, stagger: 0.055, clearProps: "transform,opacity" },
            0.12,
          );
        }
      });

      media.add(
        "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
        () => {
          const workspace = scope.current?.querySelector<HTMLElement>(".onboarding-workspace");
          const assistant = scope.current?.querySelector<HTMLElement>("[data-onboarding-assistant]");
          if (!workspace || !assistant || workspace.scrollHeight <= window.innerHeight - 112) return;

          ScrollTrigger.create({
            trigger: workspace,
            start: "top top+=104",
            end: "bottom bottom-=32",
            pin: assistant,
            pinSpacing: false,
            invalidateOnRefresh: true,
          });
        },
      );

      return () => media.revert();
    },
    { scope, dependencies: [step], revertOnUpdate: true },
  );

  return <div ref={scope} className="onboarding-motion-root">{children}</div>;
}
