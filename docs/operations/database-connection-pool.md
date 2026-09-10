# Pool de conexões do Prisma

## Estado atual (produção)

A `DATABASE_URL` da aplicação `keeprone` no Coolify termina com:

```
?connection_limit=5&pool_timeout=5
```

Cinco conexões por instância, e uma requisição desiste após cinco segundos
esperando uma conexão livre.

## Por que isso é apertado demais

Medido em 2026-09-10 no host `88.99.124.74`, com leitura direta do banco:

| Métrica | Valor |
| --- | --- |
| `max_connections` do Postgres | 100 |
| Conexões abertas no total (todos os clientes) | 25 |
| Conexões em estado `active` | 1 |
| Queries por navegação, só no caminho de autorização | ~20 antes das correções |

O banco tem folga larga; o limite de 5 é auto-imposto pelo cliente. Como uma
única troca de aba do agente encadeia dezenas de queries, poucos usuários
simultâneos bastam para as requisições passarem a competir por conexão. O
sintoma esperado é `P2024 Timed out fetching a new connection from the pool` no
Sentry, e latência que cresce em degraus conforme a concorrência sobe — não de
forma proporcional.

O `pool_timeout=5` agrava: sob fila, a requisição falha em vez de esperar.

## Mudança recomendada

```
?connection_limit=20&pool_timeout=10
```

Vinte conexões por instância deixam margem confortável dentro das 100 do
Postgres mesmo com o worker do National Life, o broker de credenciais e uma
segunda instância durante o deploy. `pool_timeout=10` dá espaço para um pico
curto sem transformá-lo em erro.

### Como aplicar

1. Coolify → projeto `keeprone` → aplicação `keeprone` → **Environment Variables**.
2. Editar `DATABASE_URL`, trocando apenas a query string do final.
3. Redeploy.

### Antes de aplicar

O Coolify builda na mesma máquina que serve o tráfego, e o host tem 4 vCPU
compartilhados com Chatwoot, Evolution API e o runtime do National Life. Fazer o
redeploy fora do horário de pico do agente.

### Como verificar depois

```bash
ssh root@88.99.124.74 \
  'docker exec c59rl8eucz4gybjo8twjaz8g psql -U lifeos_app -d lifeos \
     -c "select count(*) total, count(*) filter (where state='"'"'active'"'"') active from pg_stat_activity"'
```

O total deve subir de ~25 para algo entre 30 e 45 em uso normal, e continuar
muito abaixo de 100. Se encostar em 80, reduzir `connection_limit` em vez de
subir `max_connections`.

## Nota sobre o `.env` local

O `.env` de desenvolvimento também carrega `connection_limit=5`. Localmente isso
é inofensivo (um desenvolvedor, sem concorrência), mas convém alinhar para que o
comportamento de dev se pareça com o de produção.

## Pendente

`pg_stat_statements` não está habilitado no banco. Sem ele não há como medir
tempo real por query em produção — a auditoria de 2026-09-10 teve que inferir
custo pela leitura do código. Habilitar exige `shared_preload_libraries` e
restart do Postgres, que precisa de janela de manutenção.
