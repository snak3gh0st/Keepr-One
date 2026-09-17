#!/usr/bin/env bash
# Abre um túnel SSH para o Postgres da aplicação.
#
# O banco roda como container Coolify na mesma máquina do app e NÃO publica
# porta no host, então não dá para apontar `ssh -L` direto para 5432. O nome do
# container também não resolve no host (o DNS embutido do Docker só vale dentro
# da rede), e o IP do container muda a cada recriação. Por isso este script
# resolve o IP no momento da conexão, em vez de fixá-lo no .env.
set -euo pipefail

SERVER="${KEEPRONE_DB_SSH_HOST:-root@88.99.124.74}"
CONTAINER="${KEEPRONE_DB_CONTAINER:-c59rl8eucz4gybjo8twjaz8g}"
LOCAL_PORT="${KEEPRONE_DB_LOCAL_PORT:-55434}"

if lsof -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Já existe algo escutando em 127.0.0.1:$LOCAL_PORT — nada a fazer."
  exit 0
fi

container_ip=$(ssh -o BatchMode=yes "$SERVER" \
  "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $CONTAINER")

if [ -z "$container_ip" ]; then
  echo "Não foi possível resolver o IP do container $CONTAINER em $SERVER." >&2
  exit 1
fi

ssh -f -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o BatchMode=yes \
  -L "127.0.0.1:$LOCAL_PORT:$container_ip:5432" \
  "$SERVER"

echo "Túnel aberto: 127.0.0.1:$LOCAL_PORT -> $CONTAINER ($container_ip):5432 em $SERVER"
