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

  // Calcula os dias até o próximo aniversário de cada contato, usando datas
  // reais do calendário em vez de uma aproximação (mês * 31). Isto evita
  // erros de 7-10 dias quando lidando com meses que têm menos de 31 dias
  // ou próximo ao fim do ano, garantindo que a chegada mostra o contato
  // realmente mais próximo do aniversário.
  const daysToNextBirthday = (candidate: { dateOfBirth: Date }): number => {
    const nowYear = input.now.getUTCFullYear()
    const birthMonth = candidate.dateOfBirth.getUTCMonth()
    const birthDay = candidate.dateOfBirth.getUTCDate()

    // Tenta este ano primeiro
    const thisYearBday = new Date(Date.UTC(nowYear, birthMonth, birthDay))
    if (thisYearBday >= input.now) {
      // Aniversário ainda não passou este ano
      return Math.floor((thisYearBday.getTime() - input.now.getTime()) / (1000 * 60 * 60 * 24))
    }

    // Aniversário já passou, usa o do próximo ano
    const nextYearBday = new Date(Date.UTC(nowYear + 1, birthMonth, birthDay))
    return Math.floor((nextYearBday.getTime() - input.now.getTime()) / (1000 * 60 * 60 * 24))
  }

  const next = [...withDate].sort((left, right) => {
    return daysToNextBirthday(left) - daysToNextBirthday(right)
  })[0]!

  const day = String(next.dateOfBirth.getUTCDate()).padStart(2, '0')
  const month = String(next.dateOfBirth.getUTCMonth() + 1).padStart(2, '0')
  return {
    name: next.name,
    when: `${day}/${month}`,
    text: input.templateBody.replaceAll('{nome}', next.name),
  }
}
