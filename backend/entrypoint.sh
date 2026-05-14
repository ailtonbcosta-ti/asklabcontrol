#!/bin/sh
set -e

echo "Aguardando banco de dados..."
i=1
while [ $i -le 15 ]; do
  npx prisma db push --accept-data-loss --skip-generate && break
  echo "Banco não disponível, tentativa $i/15. Aguardando 3s..."
  i=$((i + 1))
  sleep 3
done

echo "Executando seed..."
node dist/seed.js || true

echo "Iniciando servidor..."
exec node dist/server.js
