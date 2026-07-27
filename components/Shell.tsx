"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Logo } from "@/components/Logo";
import { Avatar } from "@/components/Avatar";

type NavItem = { href: string; label: string; icon: string };

function NavIcon({ name }: { name: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    hierarchy: <><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="19" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M12 7.5v5M12 12.5H5v4M12 12.5h7v4" /></>,
    chart: <><path d="M4 19V5M4 19h16" /><path d="m7 15 3-4 3 2 5-7" /></>,
    layers: <><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></>,
    upload: <><path d="M12 16V4M8 8l4-4 4 4" /><path d="M5 14v5h14v-5" /></>,
    audit: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4M11 8v6M8 11h6" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20c.5-3 2.5-5 6-5s5.5 2 6 5M16 5.5a3 3 0 0 1 0 5.8M18 15c1.8.7 2.8 2.3 3 5" /></>,
    document: <><path d="M6 3h9l3 3v15H6zM14 3v4h4M9 12h6M9 16h6" /></>,
    money: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M7 9h.01M17 15h.01" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1 0l2.4-2.4a5 5 0 0 0-7.1-7.1L10.8 5" /><path d="M14 11a5 5 0 0 0-7.1 0l-2.4 2.4a5 5 0 0 0 7.1 7.1L13.2 19" /></>,
  };
  return <svg {...common}>{paths[name] ?? paths.grid}</svg>;
}

const NAV: Record<"ADMIN" | "AGENT" | "CLIENT", NavItem[]> = {
  ADMIN: [
    { href: "/admin", label: "Painel", icon: "grid" },
    { href: "/admin/agents", label: "Hierarquia", icon: "hierarchy" },
    { href: "/admin/pipeline", label: "Pipeline", icon: "layers" },
    { href: "/admin/production", label: "Produção", icon: "chart" },
    { href: "/admin/commission-plans", label: "Planos de comissão", icon: "layers" },
    { href: "/admin/import", label: "Importar dados", icon: "upload" },
    { href: "/admin/audit", label: "Auditoria", icon: "audit" },
    { href: "/agent/integrations/national-life", label: "Integrações", icon: "link" },
  ],
  AGENT: [
    { href: "/agent", label: "Hoje", icon: "grid" },
    { href: "/agent/cases", label: "Casos", icon: "layers" },
    { href: "/agent/clients", label: "Clientes", icon: "users" },
    { href: "/agent/policies", label: "Apólices", icon: "document" },
    { href: "/agent/commissions", label: "Comissões", icon: "money" },
    { href: "/agent/hierarchy", label: "Equipe", icon: "hierarchy" },
    { href: "/agent/integrations/national-life", label: "Integrações", icon: "link" },
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
  "/agent": "Hoje",
  "/agent/cases": "Casos",
  "/agent/cases/new": "Novo caso",
  "/agent/hierarchy": "Minha equipe",
  "/agent/clients": "Clientes",
  "/agent/policies": "Apólices",
  "/agent/policies/new": "Sobre apólices",
  "/agent/commissions": "Extrato de comissões",
  "/agent/integrations/national-life": "Conexão National Life",
  "/client": "Minhas apólices",
};

export function Shell({
  role,
  userName,
  children,
}: {
  role: "ADMIN" | "AGENT" | "CLIENT";
  userName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const items = NAV[role];
  const currentPage = PAGE_NAMES[pathname] ?? (role === "ADMIN" ? "Operação" : role === "AGENT" ? "Minha operação" : "Minha conta");
  const roleLabel = role === "ADMIN" ? "Administração" : role === "AGENT" ? "Área do agente" : "Portal do cliente";
  const quickAction =
    role === "AGENT" && pathname === "/agent"
      ? { href: "/agent/cases/new", label: "Novo caso" }
      : role === "ADMIN" && pathname === "/admin"
        ? { href: "/admin/import", label: "Importar dados" }
        : null;

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-full w-full bg-canvas md:flex">
      <a href="#main-content" className="sr-only fixed left-3 top-3 z-50 rounded-full bg-paper px-4 py-2.5 text-sm font-semibold text-ink shadow-[var(--shadow-overlay)] focus:not-sr-only">
        Ir para o conteúdo
      </a>

      <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0a0a0a] px-4 py-3 text-white md:hidden">
        <Logo size={28} className="text-base text-white" />
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-full border border-white/[0.12] px-3 py-1.5 text-xs font-semibold text-white/65 hover:bg-white/[0.07] hover:text-white focus-visible:outline-white/75"
        >
          Sair
        </button>
      </div>

      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-30 flex shrink-0 border-t border-white/[0.08] bg-[#090909] pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-16px_48px_rgba(0,0,0,0.22)] md:sticky md:top-0 md:h-screen md:w-[272px] md:flex-col md:self-start md:border-r md:border-t-0 md:border-white/[0.07] md:pb-0 md:shadow-[16px_0_56px_rgba(0,0,0,0.12)]"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block">
          <div className="absolute -left-24 -top-20 h-72 w-72 rounded-full bg-white/[0.035] blur-3xl" />
          <div className="absolute -bottom-28 -right-24 h-64 w-64 rounded-full bg-white/[0.025] blur-3xl" />
        </div>

        <div className="relative hidden px-6 pb-9 pt-7 md:block">
          <Logo size={34} className="text-xl text-white" />
          <div className="mt-7 rounded-2xl border border-white/[0.11] bg-white/[0.035] px-4 py-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">Workspace</p>
            <p className="mt-1.5 text-sm font-medium text-white/88">Operações RICOS</p>
          </div>
        </div>

        <div className="relative hidden px-6 pb-3 md:block">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">{roleLabel}</p>
        </div>

        <ul className="relative flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain md:flex-1 md:snap-none md:flex-col md:gap-1.5 md:overflow-y-auto md:px-3">
          {items.map((item) => {
            const isSection = item.href.split("/").filter(Boolean).length > 1;
            const active = pathname === item.href || (isSection && pathname.startsWith(`${item.href}/`));
            return (
              <li key={item.href} className="w-[78px] shrink-0 snap-start md:w-auto md:flex-none">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`group flex flex-1 flex-col items-center gap-1.5 whitespace-nowrap px-1 py-2.5 text-center text-[10px] font-semibold transition-all duration-300 focus-visible:outline-white/75 md:flex-row md:rounded-xl md:px-3.5 md:py-3 md:text-left md:text-[13px] ${
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

      <main id="main-content" className="min-w-0 w-full max-w-full flex-1 overflow-x-hidden bg-canvas pb-24 md:pb-0">
        <div className="sticky top-0 z-20 border-b border-border-steel/65 bg-canvas/88 px-4 backdrop-blur-xl sm:px-6 md:px-9 lg:px-12">
          <div className="mx-auto flex h-[72px] max-w-[1500px] items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted sm:block">keepr one</p>
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold tracking-[-0.02em] text-ink sm:mt-1">{currentPage}</p>
                <span className="hidden h-1 w-1 rounded-full bg-border-steel sm:block" />
                <span className="hidden items-center gap-1.5 text-xs text-ink-muted sm:flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_0_4px_oklch(0.46_0.11_155/0.1)]" />
                  Operação conectada
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden rounded-full border border-border-steel bg-paper/80 px-3 py-2 text-xs font-medium text-ink-muted lg:inline-flex">
                {roleLabel}
              </span>
              {quickAction && (
                <Link
                  href={quickAction.href}
                  className="group inline-flex min-h-10 items-center gap-2 rounded-full bg-rail-strong px-4 py-2.5 text-xs font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5"
                >
                  <span className="text-base leading-none text-mint transition-transform duration-500 group-hover:rotate-90">+</span>
                  {quickAction.label}
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="keepr-grid min-h-[calc(100vh-72px)] px-4 py-7 sm:px-6 md:px-9 md:py-10 lg:px-12">
          <div className="mx-auto max-w-[1500px]">{children}</div>
        </div>
      </main>
    </div>
  );
}
