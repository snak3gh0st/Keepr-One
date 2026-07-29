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

O agente conecta a própria conta da National Life em um navegador isolado
dentro do Keepr One:

1. o Keepr One cria uma tentativa temporária vinculada ao agente;
2. um runtime dedicado abre a página oficial da National Life/Auth0;
3. o agente informa login e MFA diretamente no navegador remoto;
4. após autenticação, somente o contexto da sessão é cifrado e vinculado ao
   agente;
5. jobs autorizados restauram esse contexto em novas sessões isoladas.

O Keepr One não possui formulário próprio para a senha da National Life e não
armazena a senha do agente. O Steel Browser permanece em rede privada; apenas o
viewer broker autenticado e temporário é exposto.

Documentação operacional:

- [`docs/operations/national-life-interactive-login-rollout.md`](docs/operations/national-life-interactive-login-rollout.md)
- [`docs/operations/distribution-core-rollout.md`](docs/operations/distribution-core-rollout.md)

## Arquitetura

- Next.js 16, React 19 e TypeScript
- Prisma 6 e PostgreSQL
- Better Auth com controle de acesso por papel
- Tailwind CSS v4
- Runtime National Life em Node.js, Playwright e Steel Browser isolado
- Coolify/Docker no host de aplicações `btapps`

Superfícies públicas:

- `https://keeprone.com`
- `https://www.keeprone.com`
- `https://app.keeprone.com`
- `https://national-life-viewer.keeprone.com` — somente o broker do viewer

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
