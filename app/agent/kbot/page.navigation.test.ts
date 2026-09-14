import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A tela do K-Bot é sobre contatos e mensagens, e saía só para os dois caminhos
// laterais: a fila de agendadas e a conexão com a seguradora. A central — onde a
// conversa de fato acontece — só existia no menu lateral, então quem chegava
// aqui para responder alguém tinha de sair da tela para achar o caminho.
//
// Teste de fonte, como `page.contacts-pagination.test.ts`: o cabeçalho é um
// componente de servidor, e o que importa fixar é que o elo existe.
describe('a tela do K-Bot leva à central de mensagens', () => {
  const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

  it('oferece o caminho para a central', () => {
    expect(source).toContain('href="/agent/mensagens"')
  })

  it('mantém os caminhos que já existiam', () => {
    expect(source).toContain('href="/agent/kbot/agendadas"')
    expect(source).toContain('href="/agent/integrations/national-life"')
  })
})
