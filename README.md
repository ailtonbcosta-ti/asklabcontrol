# ASKLabControl

Sistema de Autorização de Procedimentos de Exames Laboratoriais com balanceamento entre laboratórios credenciados.

## Stack
- **Backend**: Node.js 20 + Express + TypeScript + Prisma + PostgreSQL
- **Frontend**: Vite + React 18 + TypeScript + Tailwind + shadcn/ui
- **Integrações**: PEC (PostgreSQL externo, leitura) + DATASUS FTP (Tabela Unificada SIGTAP)
- **Deploy**: Docker / Easypanel

## Quick start (dev)
```bash
cp .env.example .env
docker compose up -d postgres
cd backend && npm install && npx prisma migrate deploy && npm run seed && npm run dev
cd frontend && npm install && npm run dev
```

## Quick start (Easypanel / produção)
```bash
docker compose up -d --build
```
Frontend em `:8080`, API em `:3000`. Login inicial conforme `SEED_ADMIN_*` no `.env`.

## Módulos
- Pacientes (cadastro local + sincronização PEC sempre)
- Autorização de Exames (balanceamento proporcional à cota mensal)
- Contratos de Credenciamento (vigência + cota mensal por procedimento)
- Tabela SIGTAP (download FTP DATASUS + import)
- Relatórios (emissões, saldos, pendências)
- Usuários (Admin / Gestor / Operador)
- Configurações (estabelecimento + tabela vigente)
