import type { OnboardingModuleName } from "@/lib/agent-onboarding";

type IconName =
  | OnboardingModuleName
  | "profile"
  | "national-life"
  | "google-calendar"
  | "whatsapp"
  | "review"
  | "arrow-left"
  | "arrow-right"
  | "check";

const paths: Record<IconName, React.ReactNode> = {
  TODAY: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  CALENDAR: <><rect x="3.5" y="5.5" width="17" height="15" rx="2" /><path d="M8 3.5v4M16 3.5v4M3.5 10h17M8 14h2M14 14h2M8 17h2" /></>,
  CRM: <><path d="M5 5.5h14M5 12h14M5 18.5h14" /><circle cx="8" cy="5.5" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="10" cy="18.5" r="2" /></>,
  MESSAGES: <path d="M20.5 12a7.5 7.5 0 0 1-7.5 7.5H8l-4.5 2v-5.1A7.5 7.5 0 0 1 3.5 12 7.5 7.5 0 0 1 11 4.5h2a7.5 7.5 0 0 1 7.5 7.5Z" />,
  POLICIES: <><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4M9 12h6M9 16h6" /></>,
  ILLUSTRATIONS: <><rect x="4" y="3.5" width="16" height="17" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="m6.5 17 4-4 2.5 2 2.5-3 2.5 5" /></>,
  COMMISSIONS: <><circle cx="12" cy="12" r="8.5" /><path d="M15.5 9.2c-.6-1-1.7-1.7-3.4-1.7-1.9 0-3.2.9-3.2 2.3 0 3.6 6.5 1.1 6.5 4.5 0 1.4-1.3 2.3-3.4 2.3-1.7 0-2.9-.6-3.6-1.7M12 5.5v13" /></>,
  JOURNEY: <><path d="M4 19 9 14l3 2 7-9" /><path d="M14.5 7H19v4.5" /></>,
  TEAM: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3.5 19c.6-3 2.5-4.5 5.5-4.5s5 1.5 5.5 4.5M14 15c2.8 0 4.7 1.3 5.3 4" /></>,
  INTEGRATIONS: <><path d="M9.5 14.5 14.5 9M7.5 17.5l-1 1a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M16.5 6.5l1-1a3.5 3.5 0 1 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20c.8-4.2 3.3-6.3 7.5-6.3s6.7 2.1 7.5 6.3" /></>,
  "national-life": <><path d="M4 20V8l8-4 8 4v12" /><path d="M8 20v-8h8v8M3 20h18" /></>,
  "google-calendar": <><rect x="3.5" y="5.5" width="17" height="15" rx="2" /><path d="M8 3.5v4M16 3.5v4M3.5 10h17" /><path d="m8 15 2.4 2.3L16 12" /></>,
  whatsapp: <><path d="M20.5 12a8.5 8.5 0 0 1-12.8 7.3L3 21l1.6-4.6A8.5 8.5 0 1 1 20.5 12Z" /><path d="M8.2 8.1c.6 3.7 2.6 5.8 6.2 7" /></>,
  review: <><path d="M6 3.5h12v17H6z" /><path d="m9 9 1.5 1.5L14 7M9 15h6" /></>,
  "arrow-left": <path d="M20 12H5M11 6l-6 6 6 6" />,
  "arrow-right": <path d="M4 12h15M13 6l6 6-6 6" />,
  check: <path d="m5 12 4.2 4.2L19 6.5" />,
};

export function OnboardingIcon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}
