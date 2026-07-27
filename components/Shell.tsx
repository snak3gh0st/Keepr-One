"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Logo } from "@/components/Logo";

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

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-full w-full bg-paper md:flex">
      <a href="#main-content" className="sr-only fixed left-3 top-3 z-50 rounded-md bg-paper px-3 py-2 text-sm font-semibold text-ink shadow-[var(--shadow-overlay)] focus:not-sr-only">
        Ir para o conteúdo
      </a>
      {/* Mobile-only top bar: deliberately far from the bottom nav so a
          distracted, one-handed tap near "Sair" can never land on a nav
          destination instead (or vice versa). */}
      <div className="flex items-center justify-between border-b border-white/10 bg-rail px-4 py-3 text-paper md:hidden">
        <Logo size={26} className="text-base" />
        <span className="mr-auto ml-3 text-xs text-paper/55">{currentPage}</span>
        <button
          type="button"
          onClick={handleSignOut}
          className="text-xs font-semibold text-paper/70 hover:text-paper"
        >
          Sair
        </button>
      </div>

      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-30 flex shrink-0 border-t border-white/10 bg-rail text-paper md:sticky md:top-0 md:h-screen md:w-[248px] md:flex-col md:self-start md:border-t-0 md:bg-rail"
      >
        <div className="hidden px-6 pb-8 pt-8 md:block">
          <Logo size={30} className="text-lg" />
          <p className="mt-3 text-xs text-paper/50">Operações RICOS</p>
        </div>
        <div className="hidden px-6 pb-2 md:block"><p className="text-xs font-semibold text-paper/45">{roleLabel}</p></div>
        <ul className="flex w-full md:flex-1 md:flex-col md:gap-1 md:overflow-y-auto md:px-3">
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <li key={item.href} className="flex-1 md:flex-none">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                    className={`flex flex-1 flex-col items-center gap-1 whitespace-nowrap px-1 py-2.5 text-center text-[10px] font-semibold transition-colors duration-150 md:flex-row md:rounded-md md:px-3 md:py-2.5 md:text-left md:text-sm ${
                      active
                      ? "bg-paper/12 text-paper"
                      : "text-paper/55 hover:bg-paper/7 hover:text-paper"
                  }`}
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="hidden border-t border-white/10 px-6 py-5 md:block">
          <p className="text-xs font-semibold text-paper/45">Conta conectada</p>
          <p className="mt-1 truncate text-sm font-medium text-paper">{userName}</p>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-2 text-xs font-semibold text-paper/55 hover:text-paper"
          >
            Sair
          </button>
        </div>
      </nav>

      <main id="main-content" className="min-w-0 flex-1 bg-canvas px-4 py-6 pb-24 md:px-9 md:py-8 md:pb-10 lg:px-12">
        <div className="mx-auto max-w-[1480px]">
          <div className="mb-8 flex items-center justify-between border-b border-border-steel/70 pb-4 text-xs">
            <div className="flex items-center gap-2 text-ink-muted"><span>Fyntra</span><span className="text-ink-muted/40">/</span><span className="font-medium text-ink">{currentPage}</span></div>
            <span className="hidden items-center gap-2 text-ink-muted sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-success" /> Operação conectada</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
