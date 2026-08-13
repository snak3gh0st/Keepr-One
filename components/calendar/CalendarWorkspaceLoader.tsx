"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { CalendarWorkspace } from "./CalendarWorkspace";

const LazyCalendarWorkspace = dynamic(
  () => import("./CalendarWorkspace").then((module) => module.CalendarWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="calendar-workspace-skeleton" role="status" aria-live="polite">
        <div className="calendar-skeleton-header">
          <i />
          <div><i /><i /></div>
          <i />
        </div>
        <div className="calendar-skeleton-toolbar"><i /><i /><i /></div>
        <div className="calendar-skeleton-body">
          <aside>{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</aside>
          <main>{Array.from({ length: 21 }, (_, index) => <i key={index} />)}</main>
        </div>
        <span>Preparando sua agenda…</span>
      </div>
    ),
  },
);

export function CalendarWorkspaceLoader(props: ComponentProps<typeof CalendarWorkspace>) {
  return <LazyCalendarWorkspace {...props} />;
}
