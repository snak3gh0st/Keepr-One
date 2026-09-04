import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_RELOADS_PER_VERSION,
  MIN_RELOAD_INTERVAL_MS,
  isBusySyncStatus,
  nudgeExtensionUpdate,
  type UpdateNudgeDeps,
  type UpdateNudgeRecord,
} from './update-nudge'

function harness(overrides: Partial<UpdateNudgeDeps> = {}) {
  // Storage persistido de mentira, mas persistido: sobrevive entre chamadas como o
  // chrome.storage.local sobrevive à morte do service worker.
  let stored: UpdateNudgeRecord | undefined
  const order: string[] = []
  let clock = 1_000_000_000_000
  const deps: UpdateNudgeDeps = {
    now: () => clock,
    version: () => '0.1.0',
    readRecord: async () => stored,
    writeRecord: async (record) => {
      // A suspensão é o teste. Sem ela, uma implementação que chamasse
      // `deps.writeRecord(...)` **sem await** produziria a mesma ordem
      // ['write','reload'] e a asserção não provaria nada — que é exatamente a
      // coisa que o módulo chama de "a trava".
      await Promise.resolve()
      order.push('write')
      stored = record
    },
    requestUpdateCheck: async () => {},
    reload: () => {
      order.push('reload')
    },
    isBusy: async () => false,
    ...overrides,
  }
  return {
    deps,
    order,
    get stored() {
      return stored
    },
    advance: (ms: number) => {
      clock += ms
    },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('empurrão de atualização', () => {
  it('recarrega uma vez e persiste a trava antes de recarregar', async () => {
    const h = harness()
    expect(await nudgeExtensionUpdate(h.deps)).toBe('RELOADED')
    // A ordem é o contrato inteiro: reload() mata o worker, então um write não
    // aguardado se perderia e a próxima inicialização leria a trava vazia. O
    // `writeRecord` do harness suspende antes de registrar, então esta asserção
    // só passa se a implementação de fato aguardou.
    expect(h.order).toEqual(['write', 'reload'])
    expect(h.stored).toMatchObject({ version: '0.1.0', reloadCount: 1 })
  })

  it('cinco chamadas rápidas produzem exatamente um reload', async () => {
    // O cenário do Chromium: kFastReloadCount = 5, kFastReloadTime = 10000. Cinco
    // reloads cada um dentro de 10s do anterior e o Chrome desabilita a extensão.
    // Em unpacked o limiar é 30 em 1s, seis vezes mais frouxo — isto nunca
    // reproduziria em desenvolvimento, então o teste é a única prova que existe.
    const h = harness()
    const outcomes: string[] = []
    for (let i = 0; i < 5; i += 1) {
      outcomes.push(await nudgeExtensionUpdate(h.deps))
      h.advance(1_000)
    }
    expect(outcomes).toEqual(['RELOADED', 'THROTTLED', 'THROTTLED', 'THROTTLED', 'THROTTLED'])
    expect(h.order.filter((entry) => entry === 'reload')).toHaveLength(1)
  })

  it('não recarrega antes do intervalo mínimo, e recarrega depois dele', async () => {
    const h = harness()
    await nudgeExtensionUpdate(h.deps)
    h.advance(MIN_RELOAD_INTERVAL_MS - 1)
    expect(await nudgeExtensionUpdate(h.deps)).toBe('THROTTLED')
    h.advance(1)
    expect(await nudgeExtensionUpdate(h.deps)).toBe('RELOADED')
  })

  it('para depois do teto de tentativas para a mesma versão', async () => {
    const h = harness()
    for (let i = 0; i < MAX_RELOADS_PER_VERSION; i += 1) {
      expect(await nudgeExtensionUpdate(h.deps)).toBe('RELOADED')
      h.advance(MIN_RELOAD_INTERVAL_MS)
    }
    // Se três reloads não trouxeram versão nova, o reload não é o problema.
    expect(await nudgeExtensionUpdate(h.deps)).toBe('EXHAUSTED')
    h.advance(MIN_RELOAD_INTERVAL_MS * 100)
    expect(await nudgeExtensionUpdate(h.deps)).toBe('EXHAUSTED')
  })

  it('o contador zera quando a versão instalada muda, e só então', async () => {
    let version = '0.1.0'
    const h = harness({ version: () => version })
    for (let i = 0; i < MAX_RELOADS_PER_VERSION; i += 1) {
      await nudgeExtensionUpdate(h.deps)
      h.advance(MIN_RELOAD_INTERVAL_MS)
    }
    expect(await nudgeExtensionUpdate(h.deps)).toBe('EXHAUSTED')
    version = '0.2.0'
    expect(await nudgeExtensionUpdate(h.deps)).toBe('RELOADED')
    expect(h.stored).toMatchObject({ version: '0.2.0', reloadCount: 1 })
  })

  it('nunca recarrega com trabalho em voo', async () => {
    const h = harness({ isBusy: async () => true })
    expect(await nudgeExtensionUpdate(h.deps)).toBe('BUSY')
    expect(h.order).toEqual([])
    // E nada foi gravado: um BUSY não pode consumir uma tentativa.
    expect(h.stored).toBeUndefined()
  })

  it('não recarrega quando não sabe a própria versão', async () => {
    // Sem versão não há como chavear o contador; um contador que não zera na
    // atualização certa é pior do que não recarregar.
    const h = harness({ version: () => undefined })
    expect(await nudgeExtensionUpdate(h.deps)).toBe('CHECK_ONLY')
    expect(h.order).toEqual([])
  })

  it('sobrevive a requestUpdateCheck que falha', async () => {
    const h = harness({ requestUpdateCheck: async () => { throw new Error('throttled') } })
    expect(await nudgeExtensionUpdate(h.deps)).toBe('RELOADED')
  })

  it('não recarrega com relógio andando para trás', async () => {
    // Um relógio que volta faria a diferença ficar negativa e passaria a trava se
    // ela fosse só "elapsed < intervalo".
    const h = harness()
    await nudgeExtensionUpdate(h.deps)
    h.advance(-MIN_RELOAD_INTERVAL_MS * 10)
    expect(await nudgeExtensionUpdate(h.deps)).toBe('THROTTLED')
  })

  it('trata como ocupado todo estado com trabalho em voo', async () => {
    for (const status of ['STARTING', 'NAVIGATING', 'EXTRACTING', 'UPLOADING', 'AUTH_REQUIRED']) {
      expect(isBusySyncStatus(status)).toBe(true)
    }
    for (const status of ['IDLE', 'COMPLETED', 'PARTIAL', 'CANCELLED', 'ERROR', undefined]) {
      expect(isBusySyncStatus(status)).toBe(false)
    }
  })
})
