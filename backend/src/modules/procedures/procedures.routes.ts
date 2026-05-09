import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ah } from '../../utils/asyncHandler';
import { authRequired, requireRole } from '../../middleware/auth';

export const proceduresRouter = Router();
proceduresRouter.use(authRequired);

const schema = z.object({
  codigo: z.string().min(1),
  descricao: z.string().min(2),
  sigtapCodigo: z.string().optional().nullable(),
  sigtapSnapshot: z.any().optional(),
  ativo: z.boolean().optional(),
});

proceduresRouter.get('/', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const onlyActive = String(req.query.ativo || '') === '1';
  const where: any = {};
  if (q) where.OR = [
    { codigo: { contains: q } },
    { sigtapCodigo: { contains: q } },
    { descricao: { contains: q, mode: 'insensitive' as const } },
  ];
  if (onlyActive) where.ativo = true;
  res.json(await prisma.procedure.findMany({ where, orderBy: { descricao: 'asc' }, take: 50 }));
}));

proceduresRouter.post('/', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const data = schema.parse(req.body);
  res.status(201).json(await prisma.procedure.create({ data }));
}));

proceduresRouter.patch('/:id', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const data = schema.partial().parse(req.body);
  res.json(await prisma.procedure.update({ where: { id: Number(req.params.id) }, data }));
}));

proceduresRouter.delete('/:id', requireRole(Role.ADMIN), ah(async (req, res) => {
  await prisma.procedure.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
  res.json({ ok: true });
}));

// Garante que existe um Procedure local vinculado a um código SIGTAP.
// Usado pelo autocomplete do contrato: o usuário busca na SIGTAP, seleciona,
// e este endpoint cria (ou retorna) o Procedure interno correspondente.
const ensureSchema = z.object({
  sigtapCodigo: z.string().min(1),
  descricao: z.string().min(1),
  snapshot: z.any().optional(),
});

proceduresRouter.post(
  '/ensure-from-sigtap',
  requireRole(Role.ADMIN, Role.GESTOR),
  ah(async (req, res) => {
    const { sigtapCodigo, descricao, snapshot } = ensureSchema.parse(req.body);
    const existing = await prisma.procedure.findFirst({
      where: { OR: [{ sigtapCodigo }, { codigo: sigtapCodigo }] },
    });
    if (existing) {
      // mantém ativo e atualiza snapshot/descrição se mudaram
      const upd = await prisma.procedure.update({
        where: { id: existing.id },
        data: { ativo: true, sigtapCodigo, sigtapSnapshot: snapshot ?? existing.sigtapSnapshot ?? undefined },
      });
      return res.json(upd);
    }
    const created = await prisma.procedure.create({
      data: { codigo: sigtapCodigo, descricao, sigtapCodigo, sigtapSnapshot: snapshot ?? undefined },
    });
    res.status(201).json(created);
  }),
);
