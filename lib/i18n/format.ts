import { localeFor, type UserLanguage } from "@/lib/i18n/config";

export function formatDate(
  value: Date | string | number,
  language: UserLanguage,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat(localeFor(language), options).format(new Date(value));
}

export function formatNumber(
  value: number,
  language: UserLanguage,
  options: Intl.NumberFormatOptions = {},
) {
  return new Intl.NumberFormat(localeFor(language), options).format(value);
}

export function formatCurrency(
  value: number,
  language: UserLanguage,
  currency = "USD",
  options: Omit<Intl.NumberFormatOptions, "style" | "currency"> = {},
) {
  return formatNumber(value, language, {
    style: "currency",
    currency,
    ...options,
  });
}
