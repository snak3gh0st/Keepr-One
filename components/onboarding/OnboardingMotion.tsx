"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

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
        const kbotVisual = root?.querySelector<HTMLElement>("[data-kbot-visual]");
        const kbotSpeech = root?.querySelector<HTMLElement>("[data-kbot-speech]");
        const marquee = root?.querySelector<HTMLElement>("[data-onboarding-marquee]");
        const stagedContent = root
          ? Array.from(root.querySelectorAll<HTMLElement>(
            ".onboarding-step-intro > *, .onboarding-profile-field, .onboarding-integration-benefit, .onboarding-unavailable, .onboarding-success-summary, .onboarding-action-row",
          ))
          : [];
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
        if (kbotVisual) {
          timeline.fromTo(
            kbotVisual,
            { scale: 0.82, opacity: 0.42 },
            { scale: 1, opacity: 1, duration: 0.58, clearProps: "transform,opacity" },
            0.1,
          );
        }
        if (kbotSpeech) {
          timeline.fromTo(
            kbotSpeech,
            { x: 14, opacity: 0 },
            { x: 0, opacity: 1, duration: 0.42, clearProps: "transform,opacity" },
            0.14,
          );
        }
        if (stagedContent.length > 0) {
          timeline.fromTo(
            stagedContent,
            { y: 9, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.32, stagger: 0.035, clearProps: "transform,opacity" },
            0.12,
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
        if (marquee) {
          gsap.to(marquee, {
            xPercent: -50,
            duration: 24,
            repeat: -1,
            ease: "none",
          });
        }
      });

      return () => media.revert();
    },
    { scope, dependencies: [step], revertOnUpdate: true },
  );

  return <div ref={scope} className="onboarding-motion-root">{children}</div>;
}
