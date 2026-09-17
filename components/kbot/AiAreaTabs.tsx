"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAgentAccessContext } from "@/components/AgentAccessContext";
import { useI18n } from "@/components/i18n/LanguageProvider";
import type { PlatformModuleName } from "@/lib/platform-modules";

/// The one navigation for everything K-Bot AI does. Each tab is a real route,
/// not client state: `/agent/ai/mensagens` must stay a path the module gate can
/// map to MESSAGES, so an agent without that module is still stopped at the
/// server and never sees the tab.
export function AiAreaTabs() {
  const { copy } = useI18n();
  const pathname = usePathname() ?? "";
  const enabledModules = useAgentAccessContext()?.enabledModules ?? null;
  const hasModule = (module: PlatformModuleName) =>
    enabledModules === null || enabledModules.includes(module);

  const tabs: Array<{ href: string; label: string; module?: PlatformModuleName }> = [
    { href: "/agent/ai", label: copy("Visão geral", "Overview") },
    { href: "/agent/ai/mensagens", label: copy("Mensagens", "Messages"), module: "MESSAGES" },
    { href: "/agent/ai/acoes", label: copy("Follow-up com AI", "AI follow-up") },
    { href: "/agent/ai/agendadas", label: copy("Agendadas", "Scheduled") },
  ];

  return (
    <nav aria-label={copy("Seções do K-Bot AI", "K-Bot AI sections")} className="mb-2 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border-steel">
        {tabs
          .filter((tab) => !tab.module || hasModule(tab.module))
          .map((tab) => {
            const active = tab.href === "/agent/ai"
              ? pathname === tab.href
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold transition-colors duration-150 ${
                    active
                      ? "border-teal text-ink"
                      : "border-transparent text-ink-muted hover:border-border-steel hover:text-ink"
                  }`}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
