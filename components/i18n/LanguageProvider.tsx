"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  languageCookieValue,
  localeFor,
  type UserLanguage,
} from "@/lib/i18n/config";
import { localize, translate, type MessageKey, type MessageValues } from "@/lib/i18n/catalog";

type LanguageContextValue = {
  language: UserLanguage;
  locale: string;
  isChanging: boolean;
  pendingLanguage: UserLanguage | null;
  error: string | null;
  changeLanguage: (language: UserLanguage) => Promise<void>;
  t: (key: MessageKey, values?: MessageValues) => string;
  copy: (portuguese: string, english: string, values?: MessageValues) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

const fallbackValue: LanguageContextValue = {
  language: "PT",
  locale: localeFor("PT"),
  isChanging: false,
  pendingLanguage: null,
  error: null,
  changeLanguage: async () => undefined,
  t: (key, values) => translate("PT", key, values),
  copy: (portuguese, english, values) => localize("PT", portuguese, english, values),
};

export function LanguageProvider({ initialLanguage, children }: { initialLanguage: UserLanguage; children: ReactNode }) {
  const router = useRouter();
  const language = initialLanguage;
  const [isSaving, setIsSaving] = useState(false);
  const [, startRefreshTransition] = useTransition();
  const [pendingLanguage, setPendingLanguage] = useState<UserLanguage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestInFlightRef = useRef(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePendingLanguage = pendingLanguage === language && !isSaving
    ? null
    : pendingLanguage;
  const isChanging = isSaving || activePendingLanguage !== null;

  const clearRefreshTimeout = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = localeFor(language);
    document.cookie = languageCookieValue(language);
  }, [language]);

  useEffect(() => {
    if (!pendingLanguage || isSaving || pendingLanguage !== language) return;

    clearRefreshTimeout();
    requestInFlightRef.current = false;
  }, [clearRefreshTimeout, isSaving, language, pendingLanguage]);

  useEffect(() => clearRefreshTimeout, [clearRefreshTimeout]);

  const changeLanguage = useCallback(async (nextLanguage: UserLanguage) => {
    if (nextLanguage === language || requestInFlightRef.current) return;

    requestInFlightRef.current = true;
    setError(null);
    setPendingLanguage(nextLanguage);
    setIsSaving(true);

    try {
      const result = await authClient.updateUser({ language: nextLanguage });
      if (result.error) throw new Error(result.error.message);
      document.cookie = languageCookieValue(nextLanguage);
      setIsSaving(false);
      startRefreshTransition(() => {
        router.refresh();
      });

      clearRefreshTimeout();
      refreshTimeoutRef.current = setTimeout(() => {
        requestInFlightRef.current = false;
        setPendingLanguage(null);
        setError(translate(language, "language.error"));
      }, 15_000);
    } catch {
      clearRefreshTimeout();
      requestInFlightRef.current = false;
      setPendingLanguage(null);
      setIsSaving(false);
      document.cookie = languageCookieValue(language);
      setError(translate(language, "language.error"));
    }
  }, [clearRefreshTimeout, language, router]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    locale: localeFor(language),
    isChanging,
    pendingLanguage: activePendingLanguage,
    error,
    changeLanguage,
    t: (key, values) => translate(language, key, values),
    copy: (portuguese, english, values) => localize(language, portuguese, english, values),
  }), [activePendingLanguage, changeLanguage, error, isChanging, language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const context = useContext(LanguageContext);
  return context ?? fallbackValue;
}
