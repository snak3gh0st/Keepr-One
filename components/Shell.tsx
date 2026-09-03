"use client";

import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAgentPromotionContext } from "@/components/AgentPromotionContext";
import { useAgentAccessContext } from "@/components/AgentAccessContext";
import { authClient } from "@/lib/auth-client";
import { Logo } from "@/components/Logo";
import { Avatar } from "@/components/Avatar";
import { NavIcon, type NavIconName } from "@/components/NavIcon";
import { CarrierSyncBadge } from "@/components/CarrierSyncBadge";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { TrialCountdown } from "@/components/trial";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { useImpersonation } from "@/components/admin/ImpersonationContext";
import type { MessageKey } from "@/lib/i18n/catalog";
import type { PlatformModuleName } from "@/lib/platform-modules";
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
  labelKey: MessageKey;
  mobileLabelKey?: MessageKey;
  icon: NavIconName;
  groupKey?: MessageKey;
  matches?: string[];
  module?: PlatformModuleName;
};

const NAV: Record<"ADMIN" | "AGENT" | "CLIENT", NavItem[]> = {
  ADMIN: [
    { href: "/admin", labelKey: "nav.dashboard", icon: "grid", groupKey: "nav.group.platform" },
    { href: "/admin/users", labelKey: "nav.users", icon: "users", groupKey: "nav.group.platform" },
  ],
  AGENT: [
    { href: "/agent", labelKey: "nav.today", icon: "grid", groupKey: "nav.group.operations", module: "TODAY" },
    { href: "/agent/calendar", labelKey: "nav.calendar", icon: "calendar", groupKey: "nav.group.operations", module: "CALENDAR" },
    {
      href: "/agent/cases",
      labelKey: "nav.crm",
      icon: "layers",
      groupKey: "nav.group.operations",
      matches: ["/agent/cases", "/agent/clients", "/agent/activities"],
      module: "CRM",
    },
    {
      href: "/agent/mensagens",
      labelKey: "nav.messages",
      icon: "chat",
      groupKey: "nav.group.operations",
      module: "MESSAGES",
    },
    { href: "/agent/policies", labelKey: "nav.policies", icon: "document", groupKey: "nav.group.portfolio", module: "POLICIES" },
    // The quotes were being written to the database and shown nowhere: the
    // screen that asked for one displayed it until the page reloaded, and
    // there was no route that listed them.
    { href: "/agent/illustrations", labelKey: "nav.illustrations", icon: "document", groupKey: "nav.group.portfolio", module: "ILLUSTRATIONS" },
    { href: "/agent/commissions", labelKey: "nav.commissions", icon: "money", groupKey: "nav.group.portfolio", module: "COMMISSIONS" },
    { href: "/agent/journey", labelKey: "nav.journey", icon: "chart", groupKey: "nav.group.portfolio", module: "JOURNEY" },
    { href: "/agent/agency", labelKey: "nav.agency", mobileLabelKey: "nav.agency", icon: "users", groupKey: "nav.group.management", module: "AGENCY" },
    { href: "/agent/hierarchy", labelKey: "nav.team", icon: "hierarchy", groupKey: "nav.group.management", module: "TEAM" },
    {
      href: "/agent/integrations",
      labelKey: "nav.integrations",
      icon: "link",
      groupKey: "nav.group.account",
      matches: ["/agent/integrations"],
      module: "INTEGRATIONS",
    },
    { href: "/agent/settings", labelKey: "nav.settings", mobileLabelKey: "common.account", icon: "settings", groupKey: "nav.group.account" },
  ],
  CLIENT: [{ href: "/client", labelKey: "nav.myPolicies", icon: "document" }],
};

const PAGE_NAMES: Record<string, MessageKey> = {
  "/admin": "page.admin",
  "/admin/users": "page.adminUsers",
  "/admin/users/new": "page.adminUserCreate",
  "/admin/agents": "page.adminAgents",
  "/admin/pipeline": "page.adminPipeline",
  "/admin/production": "page.adminProduction",
  "/admin/commission-plans": "page.adminCommissionPlans",
  "/admin/import": "page.adminImport",
  "/admin/audit": "page.adminAudit",
  "/admin/integrations/national-life": "page.adminNationalLife",
  "/agent": "page.today",
  "/agent/calendar": "page.calendar",
  "/agent/cases": "page.crmOpportunities",
  "/agent/cases/new": "page.newService",
  "/agent/activities": "page.crmActivities",
  "/agent/illustrations": "page.illustrations",
  "/agent/illustrations/new": "page.newIllustration",
  "/agent/hierarchy": "page.team",
  "/agent/agency": "page.agency",
  "/agent/clients": "page.crmClients",
  "/agent/mensagens": "page.messages",
  "/agent/policies": "page.policies",
  "/agent/policies/new": "page.aboutPolicies",
  "/agent/commissions": "page.commissions",
  "/agent/journey": "page.promotionJourney",
  "/agent/integrations/national-life": "page.nationalLife",
  "/agent/integrations": "page.integrations",
  "/agent/integrations/google-calendar": "page.googleCalendar",
  "/agent/integrations/google-calendar/scheduling": "page.schedulingLink",
  "/agent/settings": "page.accountSettings",
  "/client": "page.myPolicies",
};

function resolvePageName(pathname: string, role: "ADMIN" | "AGENT" | "CLIENT", t: (key: MessageKey) => string) {
  if (PAGE_NAMES[pathname]) return t(PAGE_NAMES[pathname]);
  if (/^\/admin\/users\/[^/]+$/.test(pathname)) return t("page.adminUserDetail");
  if (/^\/agent\/cases\/[^/]+$/.test(pathname)) return t("page.caseDetail");
  if (/^\/agent\/policies\/[^/]+$/.test(pathname)) return t("page.policyDetail");
  return role === "ADMIN" ? t("page.operation") : role === "AGENT" ? t("page.myOperation") : t("page.myAccount");
}

export function Shell({
  role,
  userName,
  promotionIdentity,
  journeyHref = "/agent/journey",
  children,
}: {
  role: "ADMIN" | "AGENT" | "CLIENT";
  userName: string;
  promotionIdentity?: PromotionIdentity;
  journeyHref?: string;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { t, language, isChanging } = useI18n();
  const impersonation = useImpersonation();
  const isJourney = role === "AGENT" && pathname === "/agent/journey";
  const promotionContext = useAgentPromotionContext();
  const agentAccess = useAgentAccessContext();
  const enabledModules = agentAccess?.enabledModules ?? null;
  const hasModule = (module: PlatformModuleName) =>
    enabledModules === null || enabledModules.includes(module);
  const setGlobalPromotionIdentity = promotionContext?.setIdentity;
  const activePromotionIdentity =
    role === "AGENT"
      ? (promotionIdentity ?? promotionContext?.identity ?? null)
      : null;
  const items = NAV[role].filter((item) => {
    if (role !== "AGENT") return true;
    if (item.module && !hasModule(item.module)) return false;
    if (item.href === "/agent/hierarchy") {
      return agentAccess?.canManageTeam === true;
    }
    return true;
  });
  const mobileItemWidth =
    role === "AGENT" ? "w-1/5 min-w-[68px]" : role === "CLIENT" ? "w-full" : "w-1/2 min-w-[92px]";
  const currentPage = resolvePageName(pathname, role, t);
  const roleLabel =
    role === "ADMIN"
      ? t("role.administration")
      : role === "CLIENT"
        ? t("role.clientPortal")
        : agentAccess?.kind === "AGENCY_OWNER"
          ? t("role.agencyPlan")
          : agentAccess?.kind === "AGENCY_MEMBER"
            ? t("role.invitedAgent")
            : t("role.agentPlan");
  const workspaceLabel =
    role !== "AGENT"
      ? role === "ADMIN"
        ? t("workspace.platform")
        : t("workspace.individualAccount")
      : agentAccess?.kind === "AGENCY_OWNER"
        ? agentAccess.agencyName ?? t("workspace.connectedAgency")
        : agentAccess?.kind === "AGENCY_MEMBER"
          ? t("workspace.linkedAgency", { agency: agentAccess.agencyName ?? t("workspace.anAgency") })
          : t("workspace.individualOperation");
  const quickAction = impersonation.active
    ? null
    : role === "AGENT" && pathname === "/agent/calendar" && hasModule("CALENDAR")
      ? { href: "/agent/calendar?create=1", label: t("action.newAppointment") }
      : role === "AGENT" && pathname === "/agent" && hasModule("CRM")
      ? { href: "/agent/cases/new", label: t("action.newService") }
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
  const trial = role === "AGENT" ? agentAccess?.trial ?? null : null;
  const showCarrierSync = role === "AGENT" && hasModule("INTEGRATIONS");

  const handleTrialExpire = useCallback(() => {
    // The server remains authoritative. Refreshing the current route makes
    // the agent layout apply the access gate and redirect to the billing page.
    router.refresh();
  }, [router]);

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
    router.push(role === "ADMIN" ? "/admin/login" : "/login");
    router.refresh();
  }

  return (
    <div
      ref={root}
      className="agent-shell min-h-full w-full bg-canvas md:flex"
      data-shell-module={isJourney ? "journey" : undefined}
    >
      <a href="#main-content" className="sr-only fixed left-3 top-3 z-50 rounded-full bg-paper px-4 py-2.5 text-sm font-semibold text-ink shadow-[var(--shadow-overlay)] focus:not-sr-only">
        {t("common.skipToContent")}
      </a>

      <div className="shell-mobile-header flex items-center justify-between border-b border-white/[0.08] bg-[#0a0a0a] px-4 py-2.5 text-white md:hidden">
        <span>
          <Logo size={28} className="text-base text-white" />
        </span>
        <div className="flex items-center gap-2">
          {role === "AGENT" ? (
            <Link
              href="/agent/settings"
              aria-label={t("common.openAccountSettings")}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/[0.12] text-white/65 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-white/75"
            >
              <NavIcon name="settings" />
            </Link>
          ) : null}
          {!impersonation.active ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="shell-signout min-h-11 rounded-full border border-white/[0.12] px-3 py-1.5 text-xs font-semibold text-white/65 hover:bg-white/[0.07] hover:text-white focus-visible:outline-white/75"
            >
              {t("common.signOut")}
            </button>
          ) : null}
        </div>
      </div>

      <nav
        aria-label={t("common.mainNavigation")}
        className={`shell-navigation fixed inset-x-0 bottom-0 z-30 flex shrink-0 border-t border-white/[0.08] bg-[#090909] pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-16px_48px_rgba(0,0,0,0.22)] md:sticky md:w-[272px] md:flex-col md:self-start md:border-r md:border-t-0 md:border-white/[0.07] md:pb-0 md:shadow-[16px_0_56px_rgba(0,0,0,0.12)] ${
          impersonation.active ? "md:top-14 md:h-[calc(100vh-3.5rem)]" : "md:top-0 md:h-screen"
        }`}
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
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">{t("common.workspace")}</p>
            <p className="mt-1.5 text-sm font-medium text-white/88">{workspaceLabel}</p>
          </div>
        </div>

        <div className="relative hidden px-6 pb-3 md:block">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">{roleLabel}</p>
        </div>

        <ul className="relative flex min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain md:w-full md:snap-none md:flex-col md:gap-1.5 md:overflow-y-auto md:px-3">
          {items.map((item, index) => {
            const matchPaths = item.matches ?? [item.href];
            const itemHref =
              role === "AGENT" && item.href === "/agent/journey"
                ? journeyHref
                : item.href;
            const active = matchPaths.some((matchPath) => {
              const isSection = matchPath.split("/").filter(Boolean).length > 1;
              return pathname === matchPath || (isSection && pathname.startsWith(`${matchPath}/`));
            });
            const beginsGroup =
              item.groupKey && (index === 0 || items[index - 1]?.groupKey !== item.groupKey);
            const itemLabel = t(item.labelKey);

            return (
              <Fragment key={item.href}>
                {beginsGroup && (
                  <li
                    role="presentation"
                    className={`hidden px-3.5 pb-1 pt-4 md:block ${index === 0 ? "md:pt-1" : ""}`}
                  >
                    <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.17em] text-white/35">
                      {item.groupKey ? t(item.groupKey) : null}
                    </span>
                  </li>
                )}
                <li className={`${mobileItemWidth} shrink-0 snap-start md:w-auto md:flex-none`}>
                  <Link
                    href={itemHref}
                    aria-label={itemLabel}
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
                    {item.mobileLabelKey ? (
                      <>
                        <span className="md:hidden">{t(item.mobileLabelKey)}</span>
                        <span className="hidden md:inline">{itemLabel}</span>
                      </>
                    ) : (
                      <span>{itemLabel}</span>
                    )}
                  </Link>
                </li>
              </Fragment>
            );
          })}
        </ul>

        <div
          className="relative flex shrink-0 items-center border-l border-white/[0.08] px-2 md:block md:w-full md:border-l-0 md:px-3 md:pb-4 md:pt-3"
          data-shell-nav-footer
        >
          <div className="md:rounded-2xl md:border md:border-white/[0.11] md:bg-white/[0.04] md:p-3">
            {role === "AGENT" ? (
              <Link
                href="/agent/settings"
                aria-label={t("common.openUserSettings", { name: userName || t("common.connectedAccount") })}
                className="hidden min-w-0 items-center gap-3 rounded-xl focus-visible:outline-white/75 md:flex"
              >
                <Avatar name={userName || t("common.account")} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{userName || t("common.connectedAccount")}</p>
                  <p className="mt-0.5 text-[11px] text-white/55">{roleLabel} · {t("common.settings")}</p>
                </div>
              </Link>
            ) : (
              <div className="hidden min-w-0 items-center gap-3 md:flex">
                <Avatar name={userName || t("common.account")} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{userName || t("common.connectedAccount")}</p>
                  <p className="mt-0.5 text-[11px] text-white/55">{roleLabel}</p>
                </div>
              </div>
            )}

            {impersonation.active ? (
              <div className="mt-3 hidden border-t border-white/[0.08] pt-3 md:block">
                <p className="text-xs font-semibold text-[#8ef0b5]">{t("preview.readOnly")}</p>
                <p className="mt-0.5 text-xs text-white/45">{t("preview.useTopBar")}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 md:mt-3 md:border-t md:border-white/[0.08] md:pt-3">
                  <div className="hidden min-w-0 md:block">
                    <p className="text-xs font-semibold text-white/85">{t("language.label")}</p>
                    <p className="mt-0.5 truncate text-xs text-white/45">
                      {isChanging
                        ? t("language.saving")
                        : t(language === "PT" ? "language.portuguese" : "language.english")}
                    </p>
                  </div>
                  <LanguageSwitcher inverse errorPlacement="above" size="navigation" />
                </div>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="mt-3 hidden min-h-9 w-full items-center justify-center rounded-xl border border-white/[0.1] text-xs font-semibold text-white/65 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-white/75 md:flex"
                >
                  {t("common.signOutAccount")}
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      <main id="main-content" className="shell-main min-w-0 w-full max-w-full flex-1 overflow-x-hidden bg-canvas pb-24 md:pb-0">
        <div
          className={`shell-topbar sticky z-20 border-b border-border-steel/65 bg-canvas/88 px-4 backdrop-blur-xl sm:px-6 md:px-9 lg:px-12 ${impersonation.active ? "top-14" : "top-0"}`}
          data-achievement-tone={hasAchievement ? achievementTone : undefined}
          aria-label={hasAchievement && rankJacket ? t("common.currentAchievement", { achievement: rankJacket }) : undefined}
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
              <div className="shell-achievement-identity flex min-w-0 items-center" data-achievement-reveal>
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
                <div className="shell-achievement-copy min-w-0">
                  <div className="shell-achievement-overline flex min-w-0 items-center">
                    <p className="shell-topbar-kicker truncate text-[10px] font-semibold uppercase tracking-[0.17em]">
                      {rankJacket}
                    </p>
                    <span className="shell-achievement-divider h-3 w-px shrink-0" />
                    <span className="shell-current-module truncate text-[10px] font-medium">
                      {currentPage}
                    </span>
                  </div>
                  <div className="shell-achievement-rank flex min-w-0 items-center">
                    <p className="shell-topbar-title truncate text-sm font-semibold tracking-[-0.02em]">
                      {rankTitle}
                    </p>
                    {showCarrierSync && <CarrierSyncBadge separated />}
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
                  {showCarrierSync && <CarrierSyncBadge />}
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
                  aria-label={t("common.jacketsEarned", { current: achievementStep, total: JACKET_TONES.length })}
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
              {hasAchievement && !isJourney && hasModule("JOURNEY") && (
                <Link
                  href={journeyHref}
                  className="shell-journey-link hidden min-h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold md:inline-flex"
                  data-achievement-reveal
                >
                  {t("common.viewJourney")}
                  <svg aria-hidden="true" viewBox="0 0 14 14" fill="none">
                    <path d="M3.25 10.75 10.75 3.25M5 3.25h5.75V9" />
                  </svg>
                </Link>
              )}
              {role === 'AGENT' && (
                <div>
                  <NotificationCenter inverse={hasAchievement} />
                </div>
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
          <div className="mx-auto max-w-[1500px]">
            {trial ? (
              <div className="mb-6" data-trial-countdown-slot>
                <TrialCountdown
                  endsAt={trial.endsAt}
                  initialRemainingSeconds={trial.initialRemainingSeconds}
                  actionHref={hasModule("AGENCY") ? "/agent/agency" : "/agent/settings"}
                  actionLabel={t("common.viewPlan")}
                  onExpire={handleTrialExpire}
                />
              </div>
            ) : null}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
