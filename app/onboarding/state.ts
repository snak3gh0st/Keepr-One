import type { AgentOnboardingView } from '@/lib/agent-onboarding'

export type OnboardingActionState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string>
  onboarding?: AgentOnboardingView
}

export const INITIAL_ONBOARDING_ACTION_STATE: OnboardingActionState = {
  status: 'idle',
}
