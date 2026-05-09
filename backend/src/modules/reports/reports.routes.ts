import { Router } from 'express';
import { AuthorizationStatus, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ah } from '../../utils/asyncHandler';
import { authRequired, requireRole } from '../../middleware/auth';

export const reportsRouter = Router();
reportsRouter.use(authRequired, requireRole(Role.ADMIN, Role.GESTOR));

reportsRouter.get(
  '/issued',
  ah(async (req, res) => {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = (() => {
      const d = req.query.to ? new Date(String(req.query.to)) : new Date();
      d.setUTCHours(23, 59, 59, 999); // cobre o dia inteiro em UTC
      return d;
    })();
    const groupBy = String(req.query.groupBy || 'day');

    // Detalhe por procedimento: uma linha por par autorização × procedimento
    if (groupBy === 'procedure') {
      const auths = await prisma.authorization.findMany({
        where: {
          emitidaEm: { gte: from, lte: to },
          NOT: { status: AuthorizationStatus.CANCELADA },
        },
        include: {
          patient: { select: { nome: true } },
          laboratory: { select: { razaoSocial: true } },
          items: { include: { procedure: { select: { codigo: true, descricao: true } } } },
        },
        orderBy: { emitidaEm: 'desc' },
        take: 1000,
      });

      const rows = auths.flatMap((a) =>
        a.items.map((it) => ({
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
          WHERE a."emitidaEm" BETWEEN $1 AND $2 AND a.status <> 'CANCELADA'
          GROUP BY 1, 2, 3
          ORDER BY 1, 3`,
        from, to,
      );
      return res.json(rows);
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT a."laboratoryId" AS laboratory_id,
              l."razaoSocial" AS laboratorio,
              COUNT(*)::int AS total
         FROM authorizations a
         JOIN laboratories l ON l.id = a."laboratoryId"
        WHERE a."emitidaEm" BETWEEN $1 AND $2 AND a.status <> 'CANCELADA'
        GROUP BY 1, 2
        ORDER BY 3 DESC`,
      from, to,
    );
    res.json(rows);
  }),
);

reportsRouter.get(
  '/balance',
  ah(async (req, res) => {
    const contractId = req.query.contractId ? Number(req.query.contractId) : undefined;
    const ano = req.query.ano ? Number(req.query.ano) : new Date().getFullYear();
    const mes = req.query.mes ? Number(req.query.mes) : new Date().getMonth() + 1;

    const cps = await prisma.contractProcedure.findMany({
      where: contractId ? { contractId, ativo: true } : { ativo: true, contract: { ativo: true } },
      include: {
        procedure: true,
        contract: { include: { laboratory: true } },
        monthlyBalances: { where: { ano, mes } },
      },
    });
    res.json(
      cps.map((cp) => ({
        contractId: cp.contractId,
        laboratorio: cp.contract.laboratory.razaoSocial,
        procedureCodigo: cp.procedure.codigo,
        procedureDescricao: cp.procedure.descricao,
        qtdMensal: cp.qtdMensal,
        qtdConsumida: cp.monthlyBalances[0]?.qtdConsumida ?? 0,
        saldo: cp.qtdMensal - (cp.monthlyBalances[0]?.qtdConsumida ?? 0),
      })),
    );
  }),
);

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
