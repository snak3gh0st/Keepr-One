export const INVITATION_VALIDITY_DAYS = 14;

export type AgencyActionState = {
  status: "idle" | "success" | "error";
  message: string;
  invitationUrl?: string;
};

export const INITIAL_AGENCY_ACTION_STATE: AgencyActionState = {
  status: "idle",
  message: "",
};

export type AgencyPlanSubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "EXPIRED";

export type AgencyPlanSubscription = {
  status: AgencyPlanSubscriptionStatus;
  unitAmountCents: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
};

const ENTITLING_SUBSCRIPTION_STATUSES = new Set<AgencyPlanSubscriptionStatus>([
  "TRIALING",
  "ACTIVE",
]);

export function isCurrentAgencyPlanSubscription(
  subscription: AgencyPlanSubscription | null,
  now: Date,
): subscription is AgencyPlanSubscription {
  return Boolean(
    subscription
      && ENTITLING_SUBSCRIPTION_STATUSES.has(subscription.status)
      && (!subscription.currentPeriodStart || subscription.currentPeriodStart <= now)
      && (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > now),
  );
}

export function currentOrLatestAgencyPlanSubscription(
  subscriptions: readonly AgencyPlanSubscription[],
  now: Date,
): AgencyPlanSubscription | null {
  return subscriptions.find((subscription) =>
    isCurrentAgencyPlanSubscription(subscription, now),
  ) ?? subscriptions[0] ?? null;
}

export type DirectInvitedSubagencyCandidate = {
  owner: {
    invitation: {
      agencyId: string;
      status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
      acceptedPlan: "AGENT_INDIVIDUAL" | "AGENCY" | "AGENT_AGENCY_MEMBER" | null;
    } | null;
  } | null;
  subscriptions: readonly AgencyPlanSubscription[];
};

/**
 * Returns the current plan only for a direct child agency that was connected
 * by an accepted Agency invitation from this exact parent. Merely having a
 * parentAgencyId is not enough to enter the commercial subscription summary.
 */
export function getActiveDirectInvitedSubagencySubscription(
  candidate: DirectInvitedSubagencyCandidate,
  parentAgencyId: string,
  now: Date,
): AgencyPlanSubscription | null {
  const invitation = candidate.owner?.invitation;
  if (
    !invitation
    || invitation.agencyId !== parentAgencyId
    || invitation.status !== "ACCEPTED"
    || invitation.acceptedPlan !== "AGENCY"
  ) {
    return null;
  }

  const subscription = currentOrLatestAgencyPlanSubscription(
    candidate.subscriptions,
    now,
  );
  return isCurrentAgencyPlanSubscription(subscription, now)
    ? subscription
    : null;
}
