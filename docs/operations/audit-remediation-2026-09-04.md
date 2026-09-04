# Auditoria e correções — 4 de setembro de 2026

Base auditada: `origin/main`, commit `1a71ad4709440a2c157a0b66a52464693b497365`.
Implementação: branch `codex/audit-remediation`, em worktree isolada.

## Resultado no código

- Agenda pública, fusos de cancelamento, validação financeira e paginação corrigidos conforme o plano da auditoria.
- Checkout de convite preserva a tentativa e impede criar uma segunda cobrança quando o resultado da primeira é incerto.
- Preview administrativo restringe mutações e recuperação de sessão trata acesso expirado.
- Carteira National usa a conta pareada do agente; NPN e número do produtor não filtram a visibilidade da carteira.
- Promoção de carteira exige páginas completas do mesmo agente, dispositivo e run. Repetições podem recuperar o pós-processamento sem sobrescrever uma apólice mais recente.
- Relatórios ficam visíveis somente depois de conciliar todas as páginas. Comissões, dados National, detalhes de apólice, documentos e produção administrativa usam a projeção verificada.
- Publicações concorrentes são serializadas; repetir uma conclusão antiga não substitui o relatório recente. Páginas de outras execuções são preservadas.
- Documentos usam referências publicadas novas, preservando referências anteriores e arquivos existentes.
- Uma falha isolada na última etapa ainda permite promover a carteira cuja etapa inforce foi completamente verificada.

## Evidência local

- Suíte geral: 3.250 testes aprovados; três testes PostgreSQL são opt-in e ficam ignorados nesta execução.
- Integração PostgreSQL: os três testes opt-in foram executados e aprovados separadamente, cobrindo concorrência, replay, página após conclusão e recuperação de PDF com conferência de bytes salvos.
- Extensão: 394 testes aprovados, typecheck e build aprovados.
- Aplicação: build e TypeScript aprovados. Lint: zero erros e seis avisos preexistentes.
- Banco descartável local: todas as 73 migrações aplicadas com sucesso, incluindo os novos vínculos de documentos.
- Auditoria de dependências continua com dois alertas transitivos: `uuid` no ExcelJS e `deepmerge-ts` no Prisma. Não foi forçada uma atualização principal sem prova de compatibilidade.

Uma execução da suíte junto com build apresentou instabilidade de testes de UI
e revelou a inicialização prematura do cliente do teste PostgreSQL desabilitado.
A inicialização foi corrigida; os testes afetados e a suíte completa passaram
na execução posterior sem build concorrente.

## Antes do teste em produção

O código está preparado localmente. Não houve push, merge, deployment, migração
em produção nem sincronização real da conta afetada.

Aplicar as migrações antes da nova imagem e drenar réplicas antigas antes de
iniciar a captura. Confirmar `BETTER_AUTH_SECRET` no ambiente de destino: o build
local terminou, mas informou ausência de um segredo configurado.

Relatórios locais anteriores ficam armazenados, porém fora dos totais até terem
prova de captura completa. Uma nova sincronização só recupera a janela fornecida
pelo portal, não necessariamente todo o histórico. A retenção futura das páginas
raw precisa respeitar consumidores de cada run.

A liberação exige conferir a conta afetada: dispositivo pareado, run, completion,
páginas, carteira e dashboard autenticado. Testes locais não comprovam esse
resultado no carrier. O roteiro está em `national-life-sync-runbook.md`.
