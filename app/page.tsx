import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicLanding } from "@/components/PublicLanding";
import { requireRoleWithoutFounderAccess } from '@/lib/require-role'

export const metadata: Metadata = {
  title: "Controle total para agentes financeiros",
  description:
    "Keepr One reúne clientes, casos, apólices, comissões e equipe em uma única perspectiva operacional.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Keepr One — Sua operação em uma só visão",
    description:
      "Do primeiro contato à comissão paga, conduza sua operação financeira com tudo em um só lugar.",
    type: "website",
    images: [
      {
        url: "/keepr-one-og.png",
        width: 1734,
        height: 907,
        alt: "Keepr One — Toda a sua operação. Sob controle.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Keepr One — Sua operação em uma só visão",
    description:
      "Do primeiro contato à comissão paga, conduza sua operação financeira com tudo em um só lugar.",
    images: ["/keepr-one-og.png"],
  },
};

export default async function Home() {
  // Only the session lookup goes in try/catch. redirect() throws a special
  // NEXT_REDIRECT signal that Next.js's router must see — catching it here
  // (by wrapping the redirect() calls themselves in the try) would silently
  // swallow the redirect and fall through to the guest landing page below,
  // which is exactly the "login works but bounces back to /" bug this
  // comment replaced.
  let role: string | null = null
  try {
    const session = await requireRoleWithoutFounderAccess('ADMIN', 'AGENT', 'CLIENT')
    role = session.user.role
  } catch {
    // Not signed in — fall through to the guest landing page.
  }

  if (role === 'ADMIN') redirect('/admin')
  if (role === 'AGENT') redirect('/agent')
  if (role === 'CLIENT') redirect('/client')

  return <PublicLanding />
}
