import type { Metadata } from "next";
import { Geist, Geist_Mono, IBM_Plex_Mono, IBM_Plex_Sans, Inter, Outfit } from "next/font/google";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import {
  ImpersonationProvider,
  type ImpersonationContextValue,
} from "@/components/admin/ImpersonationContext";
import { localeFor } from "@/lib/i18n/config";
import { getCurrentSession, getServerLanguage } from "@/lib/i18n/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "600"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["500"],
});

const metadataBase = new URL(
  process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000",
);

export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage();
  return {
    metadataBase,
    title: {
      default: "Keepr One",
      template: "%s · Keepr One",
    },
    description:
      language === "PT"
        ? "Keepr One — a visão conectada da sua operação financeira."
        : "Keepr One — a connected view of your financial operations.",
    verification: {
      google: "ZY49GxoDnNik85xinSiaIuSN90wis9Fj29iuXY6OI2U",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [language, session] = await Promise.all([
    getServerLanguage(),
    getCurrentSession(),
  ]);
  const impersonatedBy = (session?.session as { impersonatedBy?: unknown } | undefined)?.impersonatedBy;
  const currentRole = session?.user.role as unknown;
  const impersonation: ImpersonationContextValue =
    typeof impersonatedBy === "string" && (currentRole === "AGENT" || currentRole === "CLIENT")
      ? {
          active: true,
          targetId: session!.user.id,
          targetName: session!.user.name,
          targetEmail: session!.user.email,
          targetRole: currentRole,
          expiresAt: new Date(session!.session.expiresAt).toISOString(),
        }
      : { active: false };

  return (
    <html
      lang={localeFor(language)}
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${outfit.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink font-sans">
        <LanguageProvider initialLanguage={language}>
          <ImpersonationProvider value={impersonation}>
            <ImpersonationBanner />
            {children}
          </ImpersonationProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
