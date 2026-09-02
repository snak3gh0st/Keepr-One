"use client";

import { useI18n } from "@/components/i18n/LanguageProvider";
import type { UserLanguage } from "@/lib/i18n/config";

const OPTIONS: UserLanguage[] = ["PT", "EN"];

export function LanguageSwitcher({
  inverse = false,
  errorPlacement = "below",
  size = "default",
}: {
  inverse?: boolean;
  errorPlacement?: "above" | "below";
  size?: "default" | "navigation";
}) {
  const { language, changeLanguage, isChanging, pendingLanguage, error, t } = useI18n();
  const pendingLanguageName = pendingLanguage === "PT"
    ? t("language.portuguese")
    : pendingLanguage === "EN"
      ? t("language.english")
      : null;
  const loadingLabel = pendingLanguageName
    ? t("language.switching", { language: pendingLanguageName })
    : t("language.saving");

  return (
    <div className="relative" data-language-switcher>
      <div
        role="group"
        aria-label={t("language.label")}
        aria-busy={isChanging}
        data-state={isChanging ? "loading" : "idle"}
        className={`inline-flex rounded-full border p-0.5 ${
          inverse ? "border-white/[0.13] bg-white/[0.05]" : "border-border-steel bg-paper/80"
        }`}
      >
        {OPTIONS.map((option) => {
          const optionName = option === "PT" ? t("language.portuguese") : t("language.english");
          const active = language === option;
          const loading = isChanging && pendingLanguage === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => void changeLanguage(option)}
              disabled={isChanging}
              aria-pressed={active}
              aria-label={loading ? loadingLabel : t("language.changeTo", { language: optionName })}
              data-pending={loading || undefined}
              className={`relative inline-flex items-center justify-center rounded-full px-2 text-xs font-semibold tracking-[0.08em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait ${
                size === "navigation" ? "min-h-10 min-w-10 md:min-h-8 md:min-w-9" : "min-h-8 min-w-9"
              } ${
                active
                  ? inverse ? "bg-white text-[#090909]" : "bg-rail-strong text-paper"
                  : loading
                    ? inverse ? "bg-white/[0.1] text-white" : "bg-panel text-ink"
                  : inverse ? "text-white/55 hover:text-white" : "text-ink-muted hover:text-ink"
              }`}
            >
              <span className={loading ? "opacity-0" : undefined}>{option}</span>
              {loading ? (
                <span
                  aria-hidden="true"
                  className="absolute h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {isChanging && pendingLanguage ? (
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {loadingLabel}
        </span>
      ) : null}
      {error ? (
        <p
          role="alert"
          className={`absolute right-0 z-50 w-64 rounded-lg border px-3 py-2 text-xs shadow-[var(--shadow-overlay)] ${
            errorPlacement === "above" ? "bottom-full mb-2" : "top-full mt-2"
          } ${
            inverse ? "border-white/10 bg-[#171717] text-white" : "border-red-200 bg-paper text-red-700"
          }`}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
