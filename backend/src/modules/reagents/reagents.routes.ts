import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired, requireRole } from '../../middleware/auth';

export const reagentsRouter = Router();
reagentsRouter.use(authRequired);

// ── Contratos ────────────────────────────────────────────────────────────────

const contractSchema = z.object({
  cnpj: z.string().length(14, 'CNPJ deve ter 14 dígitos'),
  empresa: z.string().min(1),
  vigenciaIni: z.string(),
  vigenciaFim: z.string(),
});

const itemSchema = z.object({
  nome: z.string().min(1),
  qtdLicitada: z.number().positive(),
  valorLicitado: z.number().positive(),
});

reagentsRouter.get('/contracts', ah(async (_req, res) => {
  const list = await prisma.reagentContract.findMany({
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(list);
}));

reagentsRouter.post('/contracts', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const body = contractSchema.parse(req.body);
  const items = z.array(itemSchema).parse(req.body.items ?? []);
  const contract = await prisma.reagentContract.create({
    data: {
      ...body,
      vigenciaIni: new Date(body.vigenciaIni),
      vigenciaFim: new Date(body.vigenciaFim),
      items: { create: items },
    },
    include: { items: true },
  });
  res.status(201).json(contract);
}));

reagentsRouter.get('/contracts/:id', ah(async (req, res) => {
  const contract = await prisma.reagentContract.findUnique({
    where: { id: Number(req.params.id) },
    include: { items: true },
  });
  if (!contract) throw new HttpError(404, 'Contrato não encontrado');
  res.json(contract);
}));

reagentsRouter.put('/contracts/:id', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const id = Number(req.params.id);
  const body = contractSchema.parse(req.body);
  const items = z.array(itemSchema.extend({ id: z.number().optional() })).parse(req.body.items ?? []);

  const contract = await prisma.$transaction(async (tx) => {
    await tx.reagentContractItem.deleteMany({ where: { contractId: id } });
    return tx.reagentContract.update({
      where: { id },
      data: {
        ...body,
        vigenciaIni: new Date(body.vigenciaIni),
        vigenciaFim: new Date(body.vigenciaFim),
        updatedAt: new Date(),
        items: { create: items.map(({ id: _id, ...rest }) => rest) },
      },
      include: { items: true },
    });
  });
  res.json(contract);
}));

reagentsRouter.delete('/contracts/:id', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.reagentContract.delete({ where: { id } });
  res.json({ ok: true });
}));

// ── Consumos ─────────────────────────────────────────────────────────────────

const consumptionSchema = z.object({
  contractId: z.number().int().positive(),
  periodoIni: z.string(),
  periodoFim: z.string(),
  observacoes: z.string().optional().nullable(),
  items: z.array(z.object({
    itemId: z.number().int().positive(),
    qtdConsumida: z.number().min(0),
  })),
});

reagentsRouter.get('/consumptions', ah(async (req, res) => {
  const contractId = req.query.contractId ? Number(req.query.contractId) : undefined;
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? (() => {
    const d = new Date(String(req.query.to));
    d.setUTCHours(23, 59, 59, 999);
    return d;
  })() : undefined;

  const list = await prisma.reagentConsumption.findMany({
    where: {
      ...(contractId && { contractId }),
      ...(from || to ? {
        periodoIni: { ...(from && { gte: from }), ...(to && { lte: to }) },
      } : {}),
    },
    include: {
      contract: true,
      items: { include: { item: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json(list);
}));

reagentsRouter.post('/consumptions', ah(async (req, res) => {
  const body = consumptionSchema.parse(req.body);
  const consumption = await prisma.reagentConsumption.create({
    data: {
      contractId: body.contractId,
      periodoIni: new Date(body.periodoIni),
      periodoFim: new Date(body.periodoFim),
      observacoes: body.observacoes ?? undefined,
      items: {
        create: body.items
          .filter((i) => i.qtdConsumida > 0)
          .map((i) => ({ itemId: i.itemId, qtdConsumida: i.qtdConsumida })),
      },
    },
    include: { contract: true, items: { include: { item: true } } },
  });
  res.status(201).json(consumption);
}));

reagentsRouter.put('/consumptions/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const body = consumptionSchema.parse(req.body);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.reagentConsumptionItem.deleteMany({ where: { consumptionId: id } });
    return tx.reagentConsumption.update({
      where: { id },
      data: {
        periodoIni: new Date(body.periodoIni),
        periodoFim: new Date(body.periodoFim),
        observacoes: body.observacoes ?? undefined,
        updatedAt: new Date(),
        items: {
          create: body.items
            .filter((i) => i.qtdConsumida > 0)
            .map((i) => ({ itemId: i.itemId, qtdConsumida: i.qtdConsumida })),
        },
      },
      include: { contract: true, items: { include: { item: true } } },
    });
  });
  res.json(updated);
}));

reagentsRouter.delete('/consumptions/:id', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  await prisma.reagentConsumption.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
}));

// ── Relatório ─────────────────────────────────────────────────────────────────

reagentsRouter.get('/report', ah(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const to = (() => {
    const d = req.query.to ? new Date(String(req.query.to)) : new Date();
    d.setUTCHours(23, 59, 59, 999);
    return d;
  })();
  const contractId = req.query.contractId ? Number(req.query.contractId) : undefined;

  const contracts = await prisma.reagentContract.findMany({
    where: contractId ? { id: contractId } : undefined,
    include: {
      items: {
        include: {
          consumptionItems: {
            include: {
              consumption: {
                select: { periodoIni: true, periodoFim: true },
              },
            },
            where: {
              consumption: {
                periodoIni: { gte: from },
                periodoFim: { lte: to },
              },
            },
          },
        },
      },
    },
  });

  // Calcula qtdTotalConsumida (lifetime) para alertas de saldo
  const lifetimeMap = await prisma.reagentConsumptionItem.groupBy({
    by: ['itemId'],
    _sum: { qtdConsumida: true },
  });
  const consumed: Record<number, number> = {};
  lifetimeMap.forEach((r) => { consumed[r.itemId] = r._sum.qtdConsumida ?? 0; });

  const rows = contracts.flatMap((c) =>
    c.items.map((item) => {
      const qtdPeriodo = item.consumptionItems.reduce((acc, ci) => acc + ci.qtdConsumida, 0);
      const qtdTotalConsumida = consumed[item.id] ?? 0;
      const saldoAtual = item.qtdLicitada - qtdTotalConsumida;
      const pctSaldo = item.qtdLicitada > 0 ? (saldoAtual / item.qtdLicitada) * 100 : 0;
      return {
        contractId: c.id,
        cnpj: c.cnpj,
        empresa: c.empresa,
        vigenciaFim: c.vigenciaFim,
        itemId: item.id,
        nome: item.nome,
        qtdLicitada: item.qtdLicitada,
        valorLicitado: item.valorLicitado,
        qtdConsumidaPeriodo: qtdPeriodo,
        valorPeriodo: qtdPeriodo * item.valorLicitado,
        qtdTotalConsumida,
        saldoAtual,
        pctSaldo,
        alerta: pctSaldo <= 10 && item.qtdLicitada > 0,
      };
    }),
  );

  res.json(rows);
}));
