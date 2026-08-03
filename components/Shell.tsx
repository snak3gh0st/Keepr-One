"use client";

import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  Fragment,
  useEffect,
  useRef,
  type CSSProperties,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAgentPromotionContext } from "@/components/AgentPromotionContext";
import { authClient } from "@/lib/auth-client";
import { Logo } from "@/components/Logo";
import { Avatar } from "@/components/Avatar";
import { NavIcon, type NavIconName } from "@/components/NavIcon";
import { CarrierSyncBadge } from "@/components/CarrierSyncBadge";
import type { JacketTone, PromotionIdentity } from "@/lib/promotion-journey";

gsap.registerPlugin(useGSAP);

const JACKET_TONES: readonly JacketTone[] = [
  "blue",
  "red",
  "green",
  "purple",
  "black",
];

const JACKET_STEP: Record<JacketTone, number> = {
  blue: 1,
  red: 2,
  green: 3,
  purple: 4,
  black: 5,
};

type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  group?: string;
  matches?: string[];
};

const NAV: Record<"ADMIN" | "AGENT" | "CLIENT", NavItem[]> = {
  ADMIN: [
    { href: "/admin", label: "Painel", icon: "grid" },
    { href: "/admin/agents", label: "Hierarquia", icon: "hierarchy" },
    { href: "/admin/pipeline", label: "Pipeline", icon: "layers" },
    { href: "/admin/production", label: "Produção", icon: "chart" },
    { href: "/admin/commission-plans", label: "Planos de comissão", icon: "layers" },
    { href: "/admin/import", label: "Importar dados", icon: "upload" },
    { href: "/admin/audit", label: "Auditoria", icon: "audit" },
    { href: "/admin/integrations/national-life", label: "Integrações", icon: "link" },
  ],
  AGENT: [
    { href: "/agent", label: "Hoje", icon: "grid", group: "Operação" },
    {
      href: "/agent/cases",
      label: "CRM",
      icon: "layers",
      group: "Operação",
      matches: ["/agent/cases", "/agent/clients", "/agent/activities"],
    },
    { href: "/agent/policies", label: "Apólices", icon: "document", group: "Carteira" },
    // The quotes were being written to the database and shown nowhere: the
    // screen that asked for one displayed it until the page reloaded, and
    // there was no route that listed them.
    { href: "/agent/illustrations", label: "Ilustrações", icon: "document", group: "Carteira" },
    { href: "/agent/commissions", label: "Comissões", icon: "money", group: "Carteira" },
    { href: "/agent/journey", label: "Jornada", icon: "chart", group: "Carteira" },
    { href: "/agent/hierarchy", label: "Equipe", icon: "hierarchy", group: "Gestão" },
    {
      href: "/agent/integrations/national-life",
      label: "Integrações",
      icon: "link",
      group: "Gestão",
    },
  ],
  CLIENT: [{ href: "/client", label: "Minhas apólices", icon: "document" }],
};

const PAGE_NAMES: Record<string, string> = {
  "/admin": "Painel administrativo",
  "/admin/agents": "Agentes e hierarquia",
  "/admin/pipeline": "Pipeline de casos",
  "/admin/production": "Produção por agente",
  "/admin/commission-plans": "Planos de comissão",
  "/admin/import": "Importar dados",
  "/admin/audit": "Auditoria",
  "/admin/integrations/national-life": "Saúde da integração National Life",
  "/agent": "Hoje",
  "/agent/cases": "CRM · Oportunidades",
  "/agent/cases/new": "Novo atendimento",
  "/agent/activities": "CRM · Atividades",
  "/agent/illustrations": "Ilustrações",
  "/agent/illustrations/new": "Nova ilustração",
  "/agent/hierarchy": "Minha equipe",
  "/agent/clients": "CRM · Clientes",
  "/agent/policies": "Apólices",
  "/agent/policies/new": "Sobre apólices",
  "/agent/commissions": "Extrato de comissões",
  "/agent/journey": "Jornada de promoção",
  "/agent/integrations/national-life": "Conexão National Life",
  "/client": "Minhas apólices",
};

function resolvePageName(pathname: string, role: "ADMIN" | "AGENT" | "CLIENT") {
  if (PAGE_NAMES[pathname]) return PAGE_NAMES[pathname];
  if (/^\/agent\/cases\/[^/]+$/.test(pathname)) return "Detalhe da oportunidade";
  if (/^\/agent\/policies\/[^/]+$/.test(pathname)) return "Detalhe da apólice";
  return role === "ADMIN" ? "Operação" : role === "AGENT" ? "Minha operação" : "Minha conta";
}

export function Shell({
  role,
  userName,
  promotionIdentity,
  children,
}: {
  role: "ADMIN" | "AGENT" | "CLIENT";
  userName: string;
  promotionIdentity?: PromotionIdentity;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const isJourney = role === "AGENT" && pathname === "/agent/journey";
  const promotionContext = useAgentPromotionContext();
  const setGlobalPromotionIdentity = promotionContext?.setIdentity;
  const activePromotionIdentity =
    role === "AGENT"
      ? (promotionIdentity ?? promotionContext?.identity ?? null)
      : null;
  const items = NAV[role];
  const mobileItemWidth =
    role === "AGENT" ? "w-1/5 min-w-[68px]" : role === "CLIENT" ? "w-full" : "w-[78px]";
  const currentPage = resolvePageName(pathname, role);
  const roleLabel = role === "ADMIN" ? "Administração" : role === "AGENT" ? "Área do agente" : "Portal do cliente";
  const quickAction =
    role === "AGENT" && pathname === "/agent"
      ? { href: "/agent/cases/new", label: "Novo atendimento" }
      : role === "ADMIN" && pathname === "/admin"
        ? { href: "/admin/import", label: "Importar dados" }
        : null;
  const achievementTone =
    activePromotionIdentity?.tone !== "standard"
      ? activePromotionIdentity?.tone
      : null;
  const rankTitle = achievementTone
    ? activePromotionIdentity?.rankTitle
    : null;
  const rankJacket = achievementTone
    ? activePromotionIdentity?.jacket
    : null;
  const hasAchievement = Boolean(
    role === "AGENT" && achievementTone && rankTitle && rankJacket,
  );
  const achievementStep = achievementTone
    ? JACKET_STEP[achievementTone]
    : 0;
  const achievementKey = hasAchievement
    ? `premium-v2:${achievementTone}:${rankTitle}`
    : null;

  useEffect(() => {
    if (role === "AGENT" && promotionIdentity) {
      setGlobalPromotionIdentity?.(promotionIdentity);
    }
  }, [promotionIdentity, role, setGlobalPromotionIdentity]);

  useGSAP(
    () => {
      if (!achievementKey) return;

      let shouldAnimate = true;
      try {
        const storageKey = `keepr-one:achievement-seen:${achievementKey}`;
        shouldAnimate = window.sessionStorage.getItem(storageKey) !== "1";
        window.sessionStorage.setItem(storageKey, "1");
      } catch {
        // Restricted browser storage should not prevent the bar from rendering.
      }

      if (!shouldAnimate) return;

      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
        intro
          .fromTo(
            "[data-achievement-reveal]",
            { y: 6, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              duration: 0.38,
              stagger: 0.035,
              clearProps: "transform,opacity",
            },
          )
          .fromTo(
            "[data-achievement-mark]",
            { scale: 0.84, opacity: 0 },
            {
              scale: 1,
              opacity: 1,
              duration: 0.34,
              clearProps: "transform,opacity",
            },
            0.04,
          )
          .fromTo(
            "[data-achievement-edge]",
            { scaleX: 0 },
            {
              scaleX: 1,
              duration: 0.52,
              clearProps: "transform",
            },
            0.08,
          );

        if (achievementTone === "black") {
          gsap
            .timeline({ delay: 0.16 })
            .fromTo(
              "[data-black-achievement-sheen]",
              { xPercent: -180, opacity: 0 },
              {
                xPercent: 520,
                opacity: 0.2,
                duration: 1.18,
                ease: "power2.inOut",
              },
            )
            .to("[data-black-achievement-sheen]", {
              opacity: 0,
              duration: 0.18,
              clearProps: "transform,opacity",
            })
            .fromTo(
              "[data-black-achievement-spark]",
              { scale: 0.35, rotate: -24, opacity: 0 },
              {
                scale: 1,
                rotate: 0,
                opacity: 0.78,
                duration: 0.48,
                ease: "back.out(1.7)",
                clearProps: "transform,opacity",
              },
              0.44,
            );
        }
      });

      return () => mm.revert();
    },
    {
      scope: root,
      dependencies: [achievementKey],
      revertOnUpdate: true,
    },
  );

  async function handleSignOut() {
    window.dispatchEvent(new Event('keepr-one:sign-out'));
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div
      ref={root}
      className="agent-shell min-h-full w-full bg-canvas md:flex"
      data-shell-module={isJourney ? "journey" : undefined}
    >
      <a href="#main-content" className="sr-only fixed left-3 top-3 z-50 rounded-full bg-paper px-4 py-2.5 text-sm font-semibold text-ink shadow-[var(--shadow-overlay)] focus:not-sr-only">
        Ir para o conteúdo
      </a>

      <div className="shell-mobile-header flex items-center justify-between border-b border-white/[0.08] bg-[#0a0a0a] px-4 py-3 text-white md:hidden">
        <span>
          <Logo size={28} className="text-base text-white" />
        </span>
        <button
          type="button"
          onClick={handleSignOut}
          className="shell-signout rounded-full border border-white/[0.12] px-3 py-1.5 text-xs font-semibold text-white/65 hover:bg-white/[0.07] hover:text-white focus-visible:outline-white/75"
        >
          Sair
        </button>
      </div>

      <nav
        aria-label="Navegação principal"
        className="shell-navigation fixed inset-x-0 bottom-0 z-30 flex shrink-0 border-t border-white/[0.08] bg-[#090909] pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-16px_48px_rgba(0,0,0,0.22)] md:sticky md:top-0 md:h-screen md:w-[272px] md:flex-col md:self-start md:border-r md:border-t-0 md:border-white/[0.07] md:pb-0 md:shadow-[16px_0_56px_rgba(0,0,0,0.12)]"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block">
          <div className="absolute -left-24 -top-20 h-72 w-72 rounded-full bg-white/[0.035] blur-3xl" />
          <div className="absolute -bottom-28 -right-24 h-64 w-64 rounded-full bg-white/[0.025] blur-3xl" />
        </div>

        <div className="shell-logo-panel relative hidden px-6 pb-9 pt-7 md:block">
          <span className="inline-flex">
            <Logo size={34} className="text-xl text-white" />
          </span>
          <div className="mt-7 rounded-2xl border border-white/[0.11] bg-white/[0.035] px-4 py-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">Workspace</p>
            <p className="mt-1.5 text-sm font-medium text-white/88">Operações RICOS</p>
          </div>
        </div>

        <div className="relative hidden px-6 pb-3 md:block">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">{roleLabel}</p>
        </div>

        <ul className="relative flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain md:flex-1 md:snap-none md:flex-col md:gap-1.5 md:overflow-y-auto md:px-3">
          {items.map((item, index) => {
            const matchPaths = item.matches ?? [item.href];
            const active = matchPaths.some((matchPath) => {
              const isSection = matchPath.split("/").filter(Boolean).length > 1;
              return pathname === matchPath || (isSection && pathname.startsWith(`${matchPath}/`));
            });
            const beginsGroup =
              item.group && (index === 0 || items[index - 1]?.group !== item.group);

            return (
              <Fragment key={item.href}>
                {beginsGroup && (
                  <li
                    role="presentation"
                    className={`hidden px-3.5 pb-1 pt-4 md:block ${index === 0 ? "md:pt-1" : ""}`}
                  >
                    <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.17em] text-white/35">
                      {item.group}
                    </span>
                  </li>
                )}
                <li className={`${mobileItemWidth} shrink-0 snap-start md:w-auto md:flex-none`}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`shell-nav-link group flex flex-1 flex-col items-center gap-1.5 whitespace-nowrap px-1 py-2.5 text-center text-[10px] font-semibold transition-all duration-300 focus-visible:outline-white/75 md:flex-row md:rounded-xl md:px-3.5 md:py-3 md:text-left md:text-[13px] ${
                      active
                        ? "bg-[#f1f1ef] text-[#090909] shadow-[0_14px_32px_rgba(0,0,0,0.34)]"
                        : "text-white/55 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <span className="transition-transform duration-500 ease-out group-hover:scale-105">
                      <NavIcon name={item.icon} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              </Fragment>
            );
          })}
        </ul>

        <div className="relative hidden px-3 pb-4 pt-3 md:block">
          <div className="rounded-2xl border border-white/[0.11] bg-white/[0.04] p-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={userName || "Conta"} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{userName || "Conta conectada"}</p>
                <p className="mt-0.5 text-[11px] text-white/55">{roleLabel}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-3 flex min-h-9 w-full items-center justify-center rounded-xl border border-white/[0.1] text-xs font-semibold text-white/65 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-white/75"
            >
              Sair da conta
            </button>
          </div>
        </div>
      </nav>

      <main id="main-content" className="shell-main min-w-0 w-full max-w-full flex-1 overflow-x-hidden bg-canvas pb-24 md:pb-0">
        <div
          className="shell-topbar sticky top-0 z-20 border-b border-border-steel/65 bg-canvas/88 px-4 backdrop-blur-xl sm:px-6 md:px-9 lg:px-12"
          data-achievement-tone={hasAchievement ? achievementTone : undefined}
          aria-label={hasAchievement ? `Conquista atual: ${rankJacket}` : undefined}
        >
          {achievementTone === "black" && (
            <span
              aria-hidden="true"
              className="shell-black-achievement-sheen"
              data-black-achievement-sheen
            />
          )}
          {hasAchievement && (
            <span
              aria-hidden="true"
              className="shell-achievement-edge"
              data-achievement-edge
            />
          )}
          <div className="relative z-[1] mx-auto flex h-[72px] max-w-[1500px] items-center justify-between gap-4">
            {hasAchievement ? (
              <div className="flex min-w-0 items-center gap-3" data-achievement-reveal>
                <span className="shell-achievement-emblem" data-achievement-mark>
                  <svg
                    aria-hidden="true"
                    className="shell-achievement-mark"
                    viewBox="0 0 32 32"
                  >
                    <path d="M8 7.5 12.8 5l3.2 4 3.2-4L24 7.5l4 8-4.2 2.2-1.2-2.2.8 11.5H8.6l.8-11.5-1.2 2.2L4 15.5l4-8Z" />
                    <path d="m12.8 5 3.2 4 3.2-4-1.5 9h-3.4l-1.5-9Z" />
                  </svg>
                  {achievementTone === "black" && (
                    <span
                      aria-hidden="true"
                      className="shell-achievement-spark"
                      data-black-achievement-spark
                    />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="shell-topbar-kicker truncate text-[10px] font-semibold uppercase tracking-[0.17em]">
                      {rankJacket}
                    </p>
                    <span className="shell-achievement-divider h-0.5 w-0.5 shrink-0 rounded-full" />
                    <span className="shell-current-module truncate text-[10px] font-medium">
                      {currentPage}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <p className="shell-topbar-title truncate text-sm font-semibold tracking-[-0.02em]">
                      {rankTitle}
                    </p>
                    <span className="shell-topbar-separator hidden h-1 w-1 shrink-0 rounded-full sm:block" />
                    {role === 'AGENT' && <CarrierSyncBadge />}
                  </div>
                </div>
              </div>
            ) : (
              <div className="min-w-0">
                <p className="shell-topbar-kicker hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted sm:block">
                  keepr one
                </p>
                <div className="flex items-center gap-2">
                  <p className="shell-topbar-title truncate text-sm font-semibold tracking-[-0.02em] text-ink sm:mt-1">
                    {currentPage}
                  </p>
                  <span className="shell-topbar-separator hidden h-1 w-1 rounded-full bg-border-steel sm:block" />
                  {role === 'AGENT' && <CarrierSyncBadge />}
                </div>
              </div>
            )}
            <div className="flex shrink-0 items-center gap-2">
              {hasAchievement && achievementTone && (
                <div
                  className="shell-achievement-rail hidden items-center 2xl:flex"
                  style={
                    {
                      "--achievement-progress": `${achievementStep * 20}%`,
                    } as CSSProperties
                  }
                  aria-label={`${achievementStep} de ${JACKET_TONES.length} Jackets conquistadas`}
                  data-achievement-reveal
                >
                  <span aria-hidden="true" className="shell-achievement-track">
                    <span className="shell-achievement-progress" />
                  </span>
                  <span aria-hidden="true" className="shell-achievement-nodes">
                    {JACKET_TONES.map((tone, index) => (
                      <i
                        key={tone}
                        data-reached={index < achievementStep ? "true" : undefined}
                      />
                    ))}
                  </span>
                </div>
              )}
              {hasAchievement && !isJourney && (
                <Link
                  href="/agent/journey"
                  className="shell-journey-link hidden min-h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold md:inline-flex"
                  data-achievement-reveal
                >
                  Ver jornada
                  <svg aria-hidden="true" viewBox="0 0 14 14" fill="none">
                    <path d="M3.25 10.75 10.75 3.25M5 3.25h5.75V9" />
                  </svg>
                </Link>
              )}
              <span className="shell-role-pill hidden rounded-full border border-border-steel bg-paper/80 px-3 py-2 text-xs font-medium text-ink-muted xl:inline-flex">
                {roleLabel}
              </span>
              {quickAction && (
                <Link
                  href={quickAction.href}
                  className="shell-quick-action group inline-flex min-h-10 items-center gap-2 rounded-full bg-rail-strong px-4 py-2.5 text-xs font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5"
                >
                  <span className="text-base leading-none text-mint transition-transform duration-500 group-hover:rotate-90">+</span>
                  {quickAction.label}
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="shell-canvas keepr-grid min-h-[calc(100vh-72px)] px-4 py-7 sm:px-6 md:px-9 md:py-10 lg:px-12">
          <div className="mx-auto max-w-[1500px]">{children}</div>
        </div>
      </main>
    </div>
  );
}
