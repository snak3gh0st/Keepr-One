import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  LANGUAGE_COOKIE,
  resolveLanguagePreference,
  type UserLanguage,
} from "@/lib/i18n/config";
import { localize, translate, type MessageKey, type MessageValues } from "@/lib/i18n/catalog";

export const getCurrentSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

export const getServerLanguage = cache(async (): Promise<UserLanguage> => {
  const session = await getCurrentSession();
  return resolveLanguagePreference(
    (session?.user as { language?: unknown } | undefined)?.language,
    (await cookies()).get(LANGUAGE_COOKIE)?.value,
  );
});

export const getServerI18n = cache(async () => {
  const language = await getServerLanguage();
  return {
    language,
    t: (key: MessageKey, values?: MessageValues) => translate(language, key, values),
    copy: (portuguese: string, english: string, values?: MessageValues) =>
      localize(language, portuguese, english, values),
  };
});
