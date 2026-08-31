import Link from "next/link";
import type { DueFollowUpView } from "@/lib/crm";
import { CrmStagePill } from "@/components/StatusPill";
import { getServerI18n } from "@/lib/i18n/server";
import { localeFor } from "@/lib/i18n/config";
import { localizedCrmStage } from "./i18n";

const DATE_KEY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/New_York",
});

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function dueLabel(
  item: DueFollowUpView,
  locale: string,
  copy: (pt: string, en: string, values?: Record<string, string | number>) => string,
) {
  if (item.overdue) {
    const amount = Math.max(1, item.overdueDays);
    return amount === 1
      ? copy("Atrasado há {count} dia", "{count} day overdue", { count: amount })
      : copy("Atrasado há {count} dias", "{count} days overdue", { count: amount });
  }

  const dueTime = new Intl.DateTimeFormat(locale, {
    hour: "2-digit", minute: "2-digit", timeZone: "America/New_York",
  });
  if (DATE_KEY.format(item.scheduledAt) === DATE_KEY.format(new Date())) {
    return copy("Hoje · {time}", "Today · {time}", { time: dueTime.format(item.scheduledAt) });
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit", month: "short", year: "numeric", timeZone: "America/New_York",
  }).format(item.scheduledAt);
}

function contactDigits(phone: string) {
  return phone.replace(/\D/g, "");
}

export async function FollowUpActionCard({
  item,
  compact = false,
}: {
  item: DueFollowUpView;
  compact?: boolean;
}) {
  const { copy, language } = await getServerI18n();
  const locale = localeFor(language);
  const digits = item.prospect.phone ? contactDigits(item.prospect.phone) : "";
  const nextDate = dueLabel(item, locale, copy);
  const interactionDate = new Intl.DateTimeFormat(locale, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "America/New_York",
  });

  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border bg-paper/78 transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)] ${
        item.overdue
          ? "border-danger/25 hover:border-danger/45"
          : "border-border-steel/85 hover:border-teal/35"
      } ${compact ? "p-3.5" : "p-4 sm:p-5"}`}
    >
      <div
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-0.5 ${item.overdue ? "bg-danger" : "bg-mint"}`}
      />

      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex shrink-0 items-center justify-center rounded-xl border font-mono font-semibold ${
            item.overdue
              ? "border-danger/18 bg-danger-pale text-danger"
              : "border-teal/14 bg-teal-pale text-teal-deep"
          } ${compact ? "h-9 w-9 text-[10px]" : "h-11 w-11 text-xs"}`}
        >
          {initials(item.prospect.name) || "CL"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <Link
                href={item.href}
                className="block truncate text-sm font-semibold text-ink outline-none transition-colors hover:text-teal-deep focus-visible:rounded focus-visible:ring-[3px] focus-visible:ring-teal-pale"
              >
                {item.prospect.name}
              </Link>
              <p className="mt-0.5 truncate text-xs text-ink-muted">{item.title}</p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] ${
                item.overdue
                  ? "bg-danger-pale text-danger"
                  : "bg-gold-pale text-gold-ink"
              }`}
            >
              {nextDate}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
            <CrmStagePill stage={localizedCrmStage(copy, item.stage)} />
            {!compact ? (
              item.lastInteraction ? (
                <span className="min-w-0 truncate">
                  {copy("Última interação: {title} · {date}", "Last interaction: {title} · {date}", {
                    title: item.lastInteraction.title,
                    date: interactionDate.format(item.lastInteraction.createdAt),
                  })}
                </span>
              ) : (
                <span>{copy("Sem interação anterior registrada", "No previous interaction recorded")}</span>
              )
            ) : null}
          </div>

          <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "mt-2.5" : "mt-4"}`}>
            <Link
              href={item.href}
              className="inline-flex min-h-9 items-center justify-center rounded-full bg-rail-strong px-3 text-[11px] font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5"
            >
              {copy("Abrir lead", "Open lead")} <span aria-hidden="true" className="ml-1">↗</span>
            </Link>
            {item.prospect.phone ? (
              <a
                href={`tel:${item.prospect.phone}`}
                aria-label={copy("Ligar para {name}", "Call {name}", { name: item.prospect.name })}
                className="inline-flex min-h-9 items-center justify-center rounded-full border border-border-steel bg-paper px-3 text-[11px] font-semibold text-ink transition-colors hover:border-teal/40 hover:bg-teal-pale"
              >
                {copy("Ligar", "Call")}
              </a>
            ) : null}
            {digits ? (
              <a
                href={`https://wa.me/${digits}`}
                target="_blank"
                rel="noreferrer"
                aria-label={copy("Abrir WhatsApp de {name}", "Open {name}'s WhatsApp", { name: item.prospect.name })}
                className="inline-flex min-h-9 items-center justify-center rounded-full border border-border-steel bg-paper px-3 text-[11px] font-semibold text-ink transition-colors hover:border-teal/40 hover:bg-teal-pale"
              >
                WhatsApp
              </a>
            ) : null}
            {item.prospect.email ? (
              <a
                href={`mailto:${item.prospect.email}`}
                aria-label={copy("Enviar e-mail para {name}", "Email {name}", { name: item.prospect.name })}
                className="inline-flex min-h-9 items-center justify-center rounded-full border border-border-steel bg-paper px-3 text-[11px] font-semibold text-ink transition-colors hover:border-teal/40 hover:bg-teal-pale"
              >
                {copy("E-mail", "Email")}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
