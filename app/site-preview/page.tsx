import type { Metadata } from "next";
import { PublicLanding } from "@/components/PublicLanding";

export const metadata: Metadata = {
  title: "Preview do site",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function SitePreview() {
  return <PublicLanding />;
}
