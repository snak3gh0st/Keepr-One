import type { ReactNode } from "react";

export type NavIconName =
  | "grid"
  | "hierarchy"
  | "chart"
  | "layers"
  | "upload"
  | "audit"
  | "users"
  | "document"
  | "money";

const ICON_PATHS: Record<NavIconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  hierarchy: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="19" r="2.5" />
      <circle cx="19" cy="19" r="2.5" />
      <path d="M12 7.5v5M12 12.5H5v4M12 12.5h7v4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 19V5M4 19h16" />
      <path d="m7 15 3-4 3 2 5-7" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 8 4-8 4-8-4 8-4Z" />
      <path d="m4 12 8 4 8-4M4 17l8 4 8-4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M5 14v5h14v-5" />
    </>
  ),
  audit: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4M11 8v6M8 11h6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c.5-3 2.5-5 6-5s5.5 2 6 5M16 5.5a3 3 0 0 1 0 5.8M18 15c1.8.7 2.8 2.3 3 5" />
    </>
  ),
  document: (
    <>
      <path d="M6 3h9l3 3v15H6zM14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  money: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M7 9h.01M17 15h.01" />
    </>
  ),
};

export function NavIcon({
  name,
  size = 18,
}: {
  name: NavIconName;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
