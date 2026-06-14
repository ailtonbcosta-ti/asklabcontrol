import { Router } from 'express';
import { AuthorizationStatus, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ah } from '../../utils/asyncHandler';
import { authRequired, requireRole } from '../../middleware/auth';

export const reportsRouter = Router();
reportsRouter.use(authRequired, requireRole(Role.ADMIN, Role.GESTOR));

function parseDateRange(query: any) {
  const from = query.from ? new Date(String(query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = (() => {
    const d = query.to ? new Date(String(query.to)) : new Date();
    d.setUTCHours(23, 59, 59, 999);
    return d;
  })();
  return { from, to };
}

// ── Dashboard ────────────────────────────────────────────────────────────────
reportsRouter.get(
  '/dashboard',
  ah(async (req, res) => {
    const { from, to } = parseDateRange(req.query);
    const labId = req.query.laboratoryId ? Number(req.query.laboratoryId) : 0;

    const [authsByLab, authsByDay, topProcedures, total] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(
        `SELECT l."razaoSocial" AS laboratorio, l.id AS laboratory_id, COUNT(*)::int AS total
         FROM authorizations a
         JOIN laboratories l ON l.id = a."laboratoryId"
         WHERE a."emitidaEm" BETWEEN $1 AND $2
           AND a.status <> 'CANCELADA'
           AND ($3 = 0 OR a."laboratoryId" = $3)
         GROUP BY l.id, l."razaoSocial"
         ORDER BY total DESC`,
        from, to, labId,
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT TO_CHAR(date_trunc('day', a."emitidaEm"), 'YYYY-MM-DD') AS dia, COUNT(*)::int AS total
         FROM authorizations a
         WHERE a."emitidaEm" BETWEEN $1 AND $2
           AND a.status <> 'CANCELADA'
           AND ($3 = 0 OR a."laboratoryId" = $3)
         GROUP BY 1 ORDER BY 1`,
        from, to, labId,
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT p.codigo, p.descricao, SUM(ai.qtd)::int AS total_qtd, COUNT(DISTINCT a.id)::int AS total_auths
         FROM authorization_items ai
         JOIN authorizations a ON a.id = ai."authorizationId"
         JOIN procedures p ON p.id = ai."procedureId"
         WHERE a."emitidaEm" BETWEEN $1 AND $2
           AND a.status <> 'CANCELADA'
           AND ($3 = 0 OR a."laboratoryId" = $3)
         GROUP BY p.id, p.codigo, p.descricao
         ORDER BY total_qtd DESC
         LIMIT 15`,
        from, to, labId,
      ),
      prisma.authorization.count({
        where: {
          emitidaEm: { gte: from, lte: to },
          NOT: { status: AuthorizationStatus.CANCELADA },
          ...(labId ? { laboratoryId: labId } : {}),
        },
      }),
    ]);

    res.json({ authsByLab, authsByDay, topProcedures, totalAuths: total });
  }),
);

// ── Emissões ─────────────────────────────────────────────────────────────────
reportsRouter.get(
  '/issued',
  ah(async (req, res) => {
    const { from, to } = parseDateRange(req.query);
    const groupBy = String(req.query.groupBy || 'day');
    const labId = req.query.laboratoryId ? Number(req.query.laboratoryId) : 0;
    const procedureId = req.query.procedureId ? Number(req.query.procedureId) : 0;

    if (groupBy === 'procedure') {
      const auths = await prisma.authorization.findMany({
        where: {
          emitidaEm: { gte: from, lte: to },
          NOT: { status: AuthorizationStatus.CANCELADA },
          ...(labId ? { laboratoryId: labId } : {}),
          ...(procedureId ? { items: { some: { procedureId } } } : {}),
        },
        include: {
          patient: { select: { nome: true } },
          laboratory: { select: { razaoSocial: true } },
          items: { include: { procedure: { select: { id: true, codigo: true, descricao: true } } } },
        },
        orderBy: { emitidaEm: 'desc' },
        take: 1000,
      });

      const rows = auths.flatMap((a) =>
        a.items
          .filter((it) => !procedureId || it.procedureId === procedureId)
          .map((it) => ({
            codigo: a.codigo,
            emitida_em: a.emitidaEm,
            laboratorio: a.laboratory.razaoSocial,
            paciente: a.patient.nome,
            proc_codigo: it.procedure.codigo,
            proc_descricao: it.procedure.descricao,
            qtd: it.qtd,
          })),
      );
      return res.json(rows);
    }

    const trunc = groupBy === 'month' ? 'month' : groupBy === 'week' ? 'week' : groupBy === 'lab' ? null : 'day';

    if (trunc) {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT TO_CHAR(date_trunc('${trunc}', a."emitidaEm"), 'YYYY-MM-DD') AS bucket,
                a."laboratoryId" AS laboratory_id,
                l."razaoSocial" AS laboratorio,
                COUNT(*)::int AS total
           FROM authorizations a
           JOIN laboratories l ON l.id = a."laboratoryId"
          WHERE a."emitidaEm" BETWEEN $1 AND $2
            AND a.status <> 'CANCELADA'
            AND ($3 = 0 OR a."laboratoryId" = $3)
            AND ($4 = 0 OR EXISTS (
              SELECT 1 FROM authorization_items ai WHERE ai."authorizationId" = a.id AND ai."procedureId" = $4
            ))
          GROUP BY 1, 2, 3
          ORDER BY 1, 3`,
        from, to, labId, procedureId,
      );
      return res.json(rows);
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT a."laboratoryId" AS laboratory_id,
              l."razaoSocial" AS laboratorio,
              COUNT(*)::int AS total
         FROM authorizations a
         JOIN laboratories l ON l.id = a."laboratoryId"
        WHERE a."emitidaEm" BETWEEN $1 AND $2
          AND a.status <> 'CANCELADA'
          AND ($3 = 0 OR a."laboratoryId" = $3)
          AND ($4 = 0 OR EXISTS (
            SELECT 1 FROM authorization_items ai WHERE ai."authorizationId" = a.id AND ai."procedureId" = $4
          ))
        GROUP BY 1, 2
        ORDER BY 3 DESC`,
      from, to, labId, procedureId,
    );
    res.json(rows);
  }),
);

// ── Saldos ───────────────────────────────────────────────────────────────────
reportsRouter.get(
  '/balance',
  ah(async (req, res) => {
    const contractId = req.query.contractId ? Number(req.query.contractId) : undefined;
    const labId = req.query.laboratoryId ? Number(req.query.laboratoryId) : undefined;
    const procedureId = req.query.procedureId ? Number(req.query.procedureId) : undefined;
    const ano = req.query.ano ? Number(req.query.ano) : new Date().getFullYear();
    const mes = req.query.mes ? Number(req.query.mes) : new Date().getMonth() + 1;

    const where: any = { ativo: true, contract: { ativo: true } };
    if (contractId) where.contractId = contractId;
    if (labId) where.contract = { ...where.contract, laboratoryId: labId };
    if (procedureId) where.procedureId = procedureId;

    const cps = await prisma.contractProcedure.findMany({
      where,
      include: {
        procedure: true,
        contract: { include: { laboratory: true } },
        monthlyBalances: { where: { ano, mes } },
      },
      orderBy: [
        { procedure: { descricao: 'asc' } },
        { contract: { laboratory: { razaoSocial: 'asc' } } },
      ],
    });

    res.json(
      cps.map((cp) => ({
        contractId: cp.contractId,
        laboratoryId: cp.contract.laboratoryId,
        laboratorio: cp.contract.laboratory.razaoSocial,
        procedureId: cp.procedureId,
        procedureCodigo: cp.procedure.codigo,
        procedureDescricao: cp.procedure.descricao,
        qtdMensal: cp.qtdMensal,
        qtdConsumida: cp.monthlyBalances[0]?.qtdConsumida ?? 0,
        saldo: cp.qtdMensal - (cp.monthlyBalances[0]?.qtdConsumida ?? 0),
      })),
    );
  }),
);

// ── Pendências ────────────────────────────────────────────────────────────────
reportsRouter.get(
  '/pending',
  ah(async (_req, res) => {
    const list = await prisma.pendingItem.findMany({
      where: { resolvedAt: null },
      include: { patient: true, procedure: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json(list);
  }),
);
