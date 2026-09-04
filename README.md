# Keepr One

**Keepr One** é o sistema operacional de distribuição de seguros de vida da
RICOS. O produto organiza o trabalho do agente do prospect à apólice emitida,
com hierarquia, casos, clientes, requirements, documentos, comissões e
integrações com seguradoras em uma única operação.

## Produto

O Keepr One atende três áreas com isolamento por papel:

- **Agente** (`/agent`): fila operacional, casos, clientes, apólices,
  ilustrações, requirements, comissões e equipe/downline.
- **Cliente** (`/client`): consulta das próprias apólices e documentos.
- **Admin** (`/admin`): agentes, hierarquia, importações, planos de comissão e
  acompanhamento operacional das integrações.

O Distribution Core mantém a trilha prospect → caso → emissão/importação de
apólice, com timeline, requisitos, snapshots e ledger de comissões.

## Integração National Life

O sync de carteira tem um único engine e atravessa sempre as mesmas fronteiras:

1. o Keepr One cria o run, o plano e os checkpoints;
2. o KeeproneConnect pareado solicita a fonte planejada;
3. a extensão conduz a sessão autenticada no navegador oficial da National Life;
4. o KeeproneConnect devolve lotes raw assinados e resumíveis;
5. o Keepr One valida, elimina duplicidades/redundâncias, persiste o snapshot
   verificado e renderiza somente esse snapshot no app.

Na operação normal do conector local, o Keepr One não possui formulário próprio
nem retém a senha da National Life. O agente conclui login e MFA no navegador
oficial da seguradora. O browser remoto legado não é uma fonte de sync nem
alimenta a tela principal de dados.

**Carteira atual** é a projeção reconciliada da última exportação completa
validada da National Life. **Histórico** é uma leitura local explícita, que
preserva registros que podem não aparecer na carteira atual; ele não substitui a
evidência da carteira vigente.

Há também um caminho de credential broker que só pode ser habilitado mediante
consentimento específico. Quando habilitado, ele mantém no PostgreSQL somente
ciphertext do Vault Transit e metadados mascarados; o runtime web possui apenas
identidade de criptografia e não pode descriptografar o material. Um broker
privado separado realiza a operação de descriptografia necessária para entregar
um envelope ao dispositivo pareado, e nenhuma API revela ou copia a credencial
armazenada. Esta descrição não afirma que o recurso esteja ativo em produção;
consulte o runbook do broker antes de habilitá-lo.

Documentação operacional:

- [`docs/operations/national-life-interactive-login-rollout.md`](docs/operations/national-life-interactive-login-rollout.md)
- [`docs/operations/distribution-core-rollout.md`](docs/operations/distribution-core-rollout.md)

## Arquitetura

- Next.js 16, React 19 e TypeScript
- Prisma 6 e PostgreSQL
- Better Auth com controle de acesso por papel
- Tailwind CSS v4
- KeeproneConnect em Chrome/Edge para o sync autenticado da carteira
- Runtime National Life em Node.js, Playwright e Steel Browser isolado para
  operações legadas e superfícies que ainda não foram migradas para o conector
- Coolify/Docker para publicação do app web

O banco e alguns identificadores de infraestrutura ainda podem conservar nomes
legados. Eles não representam o nome atual do produto e não devem aparecer na
interface.

## Desenvolvimento local

```bash
pnpm install
cp .env.example .env
pnpm exec prisma migrate deploy
pnpm exec prisma db seed
pnpm dev
```

Configure `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` e as demais
variáveis exigidas pelo ambiente. Credenciais de seed são exclusivamente
locais e não devem ser reutilizadas em produção.

## Verificação

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm build
```

Um build ou healthcheck verde valida o artefato e a disponibilidade técnica; não
prova conclusão de sync no carrier, cobrança, criação de reserva ou entrega de
mensagem. Essas operações exigem a evidência específica do fluxo autorizado.

Antes de anunciar uma página pública de agendamento, confira como visitante a
página configurada e os horários retornados pela rota pública. Só trate o link
como publicado depois de confirmar slots públicos compatíveis com a agenda
configurada; uma tela carregada ou um link renderizado não é essa confirmação.

## Deploy

Mudanças são publicadas por branch e pull request para `main`. O Coolify
implanta o app web a partir de `main`.

O navegador da National Life é um serviço separado e deve ser atualizado com o
compose dedicado:

```bash
docker compose -p keeprone-national-life \
  -f deploy/national-life-runtime.compose.yaml up -d --build
```

Não publique as portas do Steel Browser nem conecte o container Steel à rede
pública do proxy.

Specs e planos versionados ficam em `docs/superpowers/specs/` e
`docs/superpowers/plans/`.
