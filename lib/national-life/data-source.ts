export type NationalLifeSourceObservation = {
  deploymentScope: string
  observedAt: Date
}

export function chooseMostRecentNationalLifeScope(
  allowedScopes: readonly string[],
  observations: readonly (NationalLifeSourceObservation | null)[],
): string {
  const allowed = new Set(allowedScopes)
  const latest = observations
    .filter(
      (observation): observation is NationalLifeSourceObservation =>
        observation !== null && allowed.has(observation.deploymentScope),
    )
    .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())[0]
  return latest?.deploymentScope ?? allowedScopes[0]
}
