/// Um prazo em volta de uma promessa que pode nunca liquidar.
///
/// `chrome.tabs.sendMessage` só responde quando a ponte responde, e a ponte só
/// responde quando o que ela pediu ao portal responde. Quando uma dessas pontas
/// fica pendurada, o `await` no service worker nunca termina: o run não erra, não
/// avança e nenhum tique do alarme consegue passar por ali de novo — foi assim que
/// uma etapa de commission earning detail ficou vinte minutos parada sem erro.
///
/// A corrida é o que dá a garantia. Cancelar a ponta lenta seria delegar o prazo a
/// quem já provou não ter nenhum; aqui a espera termina mesmo que a promessa
/// original fique pendurada para sempre.
export async function withDeadline<T>(
  value: Promise<T>,
  budgetMs: number,
  code: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), budgetMs)
  })
  // O perdedor continua vivo depois que o prazo vence: o chamador recarrega a aba
  // e a mensagem órfã rejeita com "message port closed". Quem segura essa rejeição
  // é o próprio `race`, que registra tratador em toda promessa que recebe — por
  // isso ela não pode sair daqui por outro caminho que não este. Trocar o `race`
  // por um `then`/`catch` manual devolveria uma rejeição sem dono, e uma dessas
  // derruba o service worker inteiro.
  try {
    return await Promise.race([value, deadline])
  } finally {
    clearTimeout(timer)
  }
}
