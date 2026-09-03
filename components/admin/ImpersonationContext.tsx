'use client'

import { createContext, useContext, type ReactNode } from 'react'

export type ImpersonationContextValue =
  | { active: false }
  | {
      active: true
      targetId: string
      targetName: string
      targetEmail: string
      targetRole: 'AGENT' | 'CLIENT'
      expiresAt: string
    }

const ImpersonationContext = createContext<ImpersonationContextValue>({ active: false })

export function ImpersonationProvider({
  value,
  children,
}: {
  value: ImpersonationContextValue
  children: ReactNode
}) {
  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  )
}

export function useImpersonation() {
  return useContext(ImpersonationContext)
}
