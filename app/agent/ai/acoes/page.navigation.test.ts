import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A tela de follow-up é sobre contatos e mensagens. A central, as agendadas e a
// visão geral agora são abas de K-Bot AI (`AiAreaTabs`), então o elo com elas
// vem das abas, e o cabeçalho só guarda o caminho que não é aba.
//
// Teste de fonte: o cabeçalho é um componente de servidor, e o que importa fixar
// é que o elo existe.
describe('a tela do K-Bot leva às outras áreas de K-Bot AI', () => {
  const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

  it('mostra as abas de K-Bot AI', () => {
    expect(source).toContain('<AiAreaTabs />')
  })

  it('mantém o caminho para a conexão com a seguradora', () => {
    expect(source).toContain('href="/agent/integrations/national-life"')
  })
})
