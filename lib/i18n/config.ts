export const SUPPORTED_LANGUAGES = ["PT", "EN"] as const;

export type UserLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: UserLanguage = "PT";
export const LANGUAGE_COOKIE = "keepr-one.language";
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const LANGUAGE_LOCALES: Record<UserLanguage, string> = {
  PT: "pt-BR",
  EN: "en-US",
};

export function normalizeLanguage(value: unknown): UserLanguage | null {
  return value === "PT" || value === "EN" ? value : null;
}

export function localeFor(language: UserLanguage) {
  return LANGUAGE_LOCALES[language];
}

export function resolveLanguagePreference(
  sessionValue: unknown,
  cookieValue: unknown,
): UserLanguage {
  return normalizeLanguage(sessionValue) ?? normalizeLanguage(cookieValue) ?? DEFAULT_LANGUAGE;
}

export function languageCookieValue(language: UserLanguage) {
  return `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
}
