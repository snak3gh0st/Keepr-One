/// O exemplo que a chegada mostra quando nada está ligado ainda.
///
/// Sai do texto de modelo já aprovado com o nome de um contato real — nunca de
/// uma chamada ao modelo. Gastar token do agente para ilustrar uma tela que ele
/// não pediu seria cobrar por uma demonstração.

export function toArrivalExample(input: {
  now: Date
  templateBody: string
  candidates: ReadonlyArray<{ name: string; dateOfBirth: Date | null }>
}): { name: string; when: string; text: string } | null {
  const withDate = input.candidates.filter(
    (candidate): candidate is { name: string; dateOfBirth: Date } => candidate.dateOfBirth !== null,
  )
  if (withDate.length === 0) return null

  const dayOfYear = (date: Date) => date.getUTCMonth() * 31 + date.getUTCDate()
  const today = dayOfYear(input.now)
  const next = [...withDate].sort((left, right) => {
    const distance = (candidate: { dateOfBirth: Date }) => {
      const value = dayOfYear(candidate.dateOfBirth) - today
      return value < 0 ? value + 372 : value
    }
    return distance(left) - distance(right)
  })[0]!

  const day = String(next.dateOfBirth.getUTCDate()).padStart(2, '0')
  const month = String(next.dateOfBirth.getUTCMonth() + 1).padStart(2, '0')
  return {
    name: next.name,
    when: `${day}/${month}`,
    text: input.templateBody.replaceAll('{nome}', next.name),
  }
}
