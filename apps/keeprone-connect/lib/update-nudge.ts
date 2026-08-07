/// Empurrão de atualização, com a trava que não é opcional.
///
/// ⚠️ O Chromium conta reloads: `kFastReloadCount = 5` e `kFastReloadTime = 10000`.
/// Cinco `chrome.runtime.reload()` cada um dentro de 10s do anterior e o Chrome
/// **encerra e desabilita a extensão**. Em modo unpacked o limiar é 30 em 1s —
/// seis vezes mais frouxo —, então esse tiro no pé **nunca reproduz em
/// desenvolvimento**. O Bitwarden enviou exatamente esse bug para produção.
///
/// Três consequências, todas encarnadas no código abaixo:
///
/// 1. A trava é **persistida**. Um global de módulo morre junto com o service
///    worker, e `reload()` mata o service worker — a trava recomeçaria zerada em
///    todo reload, que é precisamente a forma do laço.
/// 2. A escrita é **aguardada antes** do reload. `chrome.runtime.reload()` derruba
///    o worker no ato: um `storage.set` não aguardado se perde, e a próxima
///    inicialização lê a trava vazia. Aguardar não é capricho, é a trava.
/// 3. Nunca com trabalho em voo. `reload()` mata fetches em andamento e portas de
///    content script sem aviso; um upload no meio viraria um run pendurado.
///
/// E o empurrão em si é modesto de propósito: `requestUpdateCheck()` cai no mesmo
/// backoff de 5h e só zera quando uma atualização instala de verdade. Reload aqui
/// serve para *aplicar* uma atualização já baixada que o Chrome não instala porque
/// o nosso worker vive acordado — não para acelerar o download.

export const UPDATE_NUDGE_KEY = 'updateNudge'

/// Ordens de grandeza acima da janela de 10s do Chromium. Mesmo que toda a lógica
/// de estado acima falhasse, o relógio sozinho impediria dois reloads seguidos de
/// caírem na mesma janela.
export const MIN_RELOAD_INTERVAL_MS = 6 * 60 * 60 * 1000

/// Se três reloads não trouxeram versão nova, o problema não é o reload. Continuar
/// é gastar a sessão do agente contra uma parede.
export const MAX_RELOADS_PER_VERSION = 3

/// Estados em que existe trabalho em voo. `IDLE`, `COMPLETED` e `ERROR` são pontos
/// seguros — não há fetch nem porta de content script a perder.
export const BUSY_SYNC_STATUSES: readonly string[] = [
  'STARTING',
  'NAVIGATING',
  'EXTRACTING',
  'UPLOADING',
  'AUTH_REQUIRED',
]

export type UpdateNudgeRecord = {
  /// A versão que estava rodando quando o reload foi disparado. Chaveia o contador
  /// na versão instalada, então ele zera sozinho quando uma atualização de verdade
  /// entra — e **nunca** zera enquanto ela não entra.
  version: string
  reloadCount: number
  lastReloadAt: number
}

export type UpdateNudgeOutcome =
  | 'RELOADED'
  | 'THROTTLED'
  | 'BUSY'
  | 'EXHAUSTED'
  | 'CHECK_ONLY'

export type UpdateNudgeDeps = {
  now: () => number
  version: () => string | undefined
  readRecord: () => Promise<UpdateNudgeRecord | undefined>
  /// Tem de resolver **antes** de `reload` ser chamado. É a trava inteira.
  writeRecord: (record: UpdateNudgeRecord) => Promise<void>
  requestUpdateCheck: () => Promise<void>
  reload: () => void
  /// `true` quando há trabalho em voo. Precisa olhar o estado persistido, não só
  /// os mapas em memória: num worker recém-iniciado os mapas estão vazios embora
  /// um run esteja genuinamente no meio segundo o storage.
  isBusy: () => Promise<boolean>
}

export function isBusySyncStatus(status: string | undefined): boolean {
  return typeof status === 'string' && BUSY_SYNC_STATUSES.includes(status)
}

/// Devolve o que foi feito, para o chamador não ter de adivinhar. O `requestUpdateCheck`
/// acontece sempre — é barato, o Chrome já o limita, e é a metade do empurrão que
/// não corre risco nenhum.
export async function nudgeExtensionUpdate(deps: UpdateNudgeDeps): Promise<UpdateNudgeOutcome> {
  try {
    await deps.requestUpdateCheck()
  } catch {
    // Sem permissão, offline, ou dentro do backoff de 5h. Nada disso muda a decisão
    // de reload abaixo, e nenhum deles é motivo para desistir do empurrão.
  }

  const version = deps.version()
  // Sem saber a própria versão não há como chavear o contador, e um contador que
  // não zera na atualização certa é pior do que não recarregar.
  if (!version) return 'CHECK_ONLY'

  const record = await deps.readRecord()
  const current: UpdateNudgeRecord =
    record && record.version === version
      ? record
      : { version, reloadCount: 0, lastReloadAt: 0 }

  if (current.reloadCount >= MAX_RELOADS_PER_VERSION) return 'EXHAUSTED'

  const now = deps.now()
  // `>=` e não `>`: dois disparos no mesmo milissegundo não podem ambos passar.
  // Relógio que anda para trás também é barrado, porque a diferença fica negativa.
  const elapsed = now - current.lastReloadAt
  if (current.lastReloadAt !== 0 && (elapsed < MIN_RELOAD_INTERVAL_MS || elapsed < 0)) {
    return 'THROTTLED'
  }

  // Depois da trava de tempo, de propósito: a checagem de ocupado é a mais cara e
  // a mais sujeita a corrida, e não faz sentido pagá-la quando o relógio já barrou.
  if (await deps.isBusy()) return 'BUSY'

  // A ordem aqui é o contrato. Escrever, **aguardar**, e só então recarregar.
  await deps.writeRecord({
    version,
    reloadCount: current.reloadCount + 1,
    lastReloadAt: now,
  })
  deps.reload()
  return 'RELOADED'
}
