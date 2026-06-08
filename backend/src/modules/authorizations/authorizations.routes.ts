import { Router } from 'express';
import { z } from 'zod';
import { AuthorizationStatus, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired, requireRole } from '../../middleware/auth';
import { carregarSaldos, planejar, gerarCodigoAutorizacao, ExameSolicitado } from './balancer';

export const authorizationsRouter = Router();
authorizationsRouter.use(authRequired);

const emitSchema = z.object({
  patientId: z.number().int().positive(),
  exames: z.array(z.object({ procedureId: z.number().int().positive(), qtd: z.number().int().positive().default(1) })).min(1),
  observacoes: z.string().optional().nullable(),
});

authorizationsRouter.post(
  '/simulate',
  ah(async (req, res) => {
    const body = emitSchema.parse(req.body);
    const now = new Date();
    const contratos = await carregarSaldos(prisma, now.getFullYear(), now.getMonth() + 1);
    const plano = planejar(contratos, body.exames as ExameSolicitado[]);
    res.json(plano);
  }),
);

authorizationsRouter.post(
  '/',
  ah(async (req, res) => {
    const body = emitSchema.parse(req.body);
    const userId = req.user!.id;
    const cfg = await prisma.establishmentConfig.findUnique({ where: { id: 1 } });
    const validadeDias = cfg?.validadeAutorizacaoDias ?? 30;

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const ano = now.getFullYear();
      const mes = now.getMonth() + 1;

      // SERIALIZABLE para evitar overbooking
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

      const contratos = await carregarSaldos(tx as any, ano, mes);
      const plano = planejar(contratos, body.exames as ExameSolicitado[]);

      const validaAte = new Date(now.getTime() + validadeDias * 24 * 60 * 60 * 1000);
      const isPartial = plano.pendentes.length > 0;

      const auths: any[] = [];

      for (const a of plano.autorizacoes) {
        // Insert with temporary unique placeholder; update with id-based code after INSERT.
        // Using the row's own auto-increment id eliminates all race conditions on codigo.
        const tempCodigo = `__tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        const inserted = await tx.authorization.create({
          data: {
            codigo: tempCodigo,
            patientId: body.patientId,
            userId,
            laboratoryId: a.laboratoryId,
            contractId: a.contractId,
            validaAte,
            status: isPartial ? AuthorizationStatus.PARCIAL_PENDENTE : AuthorizationStatus.EMITIDA,
            observacoes: body.observacoes ?? undefined,
            items: {
              create: a.items.map((it) => ({
                procedureId: it.procedureId,
                contractProcedureId: it.contractProcedureId,
                qtd: it.qtd,
                valorUnitarioSnapshot: it.valorUnitario,
              })),
            },
          },
        });

        const codigo = gerarCodigoAutorizacao(inserted.id);
        const created = await tx.authorization.update({
          where: { id: inserted.id },
          data: { codigo },
          include: { items: true, laboratory: true, contract: true },
        });

        for (const it of a.items) {
          await tx.contractMonthlyBalance.update({
            where: { contractProcedureId_ano_mes: { contractProcedureId: it.contractProcedureId, ano, mes } },
            data: { qtdConsumida: { increment: it.qtd } },
          });
        }
        auths.push(created);
      }

      const pendentes = [];
      for (const p of plano.pendentes) {
        const pi = await tx.pendingItem.create({
          data: { patientId: body.patientId, procedureId: p.procedureId, qtd: p.qtd, motivo: p.motivo },
        });
        pendentes.push(pi);
      }

      return { auths, pendentes, plano };
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 });

    res.status(201).json(result);
  }),
);


authorizationsRouter.get('/', ah(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? (() => { const d = new Date(String(req.query.to)); d.setUTCHours(23, 59, 59, 999); return d; })() : undefined;
  const labId = req.query.laboratoryId ? Number(req.query.laboratoryId) : undefined;
  const status = req.query.status as AuthorizationStatus | undefined;
  const where: any = {};
  if (from || to) where.emitidaEm = { ...(from && { gte: from }), ...(to && { lte: to }) };
  if (labId) where.laboratoryId = labId;
  if (status) where.status = status;
  const list = await prisma.authorization.findMany({
    where,
    take: 200,
    orderBy: { emitidaEm: 'desc' },
    include: { patient: true, laboratory: true, items: { include: { procedure: true } } },
  });
  res.json(list);
}));

authorizationsRouter.get('/:id', ah(async (req, res) => {
  const a = await prisma.authorization.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      patient: true,
      laboratory: true,
      contract: true,
      user: { select: { nome: true, matricula: true } },
      items: { include: { procedure: true } },
    },
  });
  if (!a) throw new HttpError(404, 'Autorização não encontrada');
  res.json(a);
}));

authorizationsRouter.delete('/:id', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.$transaction(async (tx) => {
    const a = await tx.authorization.findUnique({ where: { id }, include: { items: true } });
    if (!a) throw new HttpError(404, 'Autorização não encontrada');

    // Restaura saldo apenas se a autorização não estava cancelada (cancelamento já restaura)
    if (a.status !== AuthorizationStatus.CANCELADA) {
      const ano = a.emitidaEm.getFullYear();
      const mes = a.emitidaEm.getMonth() + 1;
      for (const it of a.items) {
        await tx.contractMonthlyBalance.updateMany({
          where: { contractProcedureId: it.contractProcedureId, ano, mes },
          data: { qtdConsumida: { decrement: it.qtd } },
        });
      }
    }

    await tx.authorization.delete({ where: { id } });
  });
  res.json({ ok: true });
}));

authorizationsRouter.post('/:id/cancel', ah(async (req, res) => {
  const id = Number(req.params.id);
  const motivo = String(req.body?.motivo || 'Cancelamento');
  const result = await prisma.$transaction(async (tx) => {
    const a = await tx.authorization.findUnique({ where: { id }, include: { items: true } });
    if (!a) throw new HttpError(404, 'Autorização não encontrada');
    if (a.status === AuthorizationStatus.CANCELADA) throw new HttpError(400, 'Já cancelada');
    const now = new Date();
    const ano = a.emitidaEm.getFullYear();
    const mes = a.emitidaEm.getMonth() + 1;
    for (const it of a.items) {
      await tx.contractMonthlyBalance.update({
        where: { contractProcedureId_ano_mes: { contractProcedureId: it.contractProcedureId, ano, mes } },
        data: { qtdConsumida: { decrement: it.qtd } },
      });
    }
    return tx.authorization.update({
      where: { id },
      data: { status: AuthorizationStatus.CANCELADA, canceledAt: now, cancelReason: motivo },
    });
  });
  res.json(result);
}));
