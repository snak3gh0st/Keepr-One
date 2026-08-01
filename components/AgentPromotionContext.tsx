"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { PromotionIdentity } from "@/lib/promotion-journey";

export type AgentPromotionContextValue = {
  identity: PromotionIdentity | null;
  setIdentity: Dispatch<SetStateAction<PromotionIdentity | null>>;
};

const AgentPromotionContext = createContext<AgentPromotionContextValue | null>(
  null,
);

export function AgentPromotionProvider({
  initialIdentity,
  children,
}: {
  initialIdentity: PromotionIdentity | null;
  children: React.ReactNode;
}) {
  const [identity, setIdentity] =
    useState<PromotionIdentity | null>(initialIdentity);
  const value = useMemo(
    () => ({ identity, setIdentity }),
    [identity],
  );

  return (
    <AgentPromotionContext.Provider value={value}>
      {children}
    </AgentPromotionContext.Provider>
  );
}

/**
 * Nullable by design: Shell is also used by admin/client portals and can be
 * rendered in isolated component tests without the /agent layout.
 */
export function useAgentPromotionContext() {
  return useContext(AgentPromotionContext);
}
