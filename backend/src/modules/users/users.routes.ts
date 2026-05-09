import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired, requireRole } from '../../middleware/auth';

export const usersRouter = Router();
usersRouter.use(authRequired);

usersRouter.get(
  '/',
  requireRole(Role.ADMIN),
  ah(async (_req, res) => {
    const list = await prisma.user.findMany({
      orderBy: { nome: 'asc' },
      select: { id: true, matricula: true, nome: true, email: true, role: true, ativo: true, ultimoLogin: true, createdAt: true },
    });
    res.json(list);
  }),
);

const matriculaField = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v.replace(/\D/g, '') : v))
  .refine((v) => !v || /^\d{7}$/.test(v), { message: 'Matrícula deve ter exatamente 7 dígitos' });

const upsertSchema = z.object({
  matricula: matriculaField,
  nome: z.string().min(2),
  email: z.string().email(),
  role: z.nativeEnum(Role),
  ativo: z.boolean().default(true),
  senha: z.string().min(6).optional(),
});

usersRouter.post(
  '/',
  requireRole(Role.ADMIN),
  ah(async (req, res) => {
    const data = upsertSchema.parse(req.body);
    if (!data.senha) throw new HttpError(400, 'Senha obrigatória');
    const senhaHash = await bcrypt.hash(data.senha, 10);
    const u = await prisma.user.create({
      data: {
        matricula: data.matricula || null,
        nome: data.nome,
        email: data.email.toLowerCase(),
        role: data.role,
        ativo: data.ativo,
        senhaHash,
      },
      select: { id: true, matricula: true, nome: true, email: true, role: true, ativo: true },
    });
    res.status(201).json(u);
  }),
);

usersRouter.patch(
  '/:id',
  requireRole(Role.ADMIN),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const data = upsertSchema.partial().parse(req.body);
    const update: any = { ...data };
    if (data.email) update.email = data.email.toLowerCase();
    if (data.senha) update.senhaHash = await bcrypt.hash(data.senha, 10);
    delete update.senha;
    const u = await prisma.user.update({
      where: { id },
      data: update,
      select: { id: true, matricula: true, nome: true, email: true, role: true, ativo: true },
    });
    res.json(u);
  }),
);

usersRouter.delete(
  '/:id',
  requireRole(Role.ADMIN),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (req.user!.id === id) throw new HttpError(400, 'Não é possível excluir a própria conta');
    await prisma.user.update({ where: { id }, data: { ativo: false } });
    res.json({ ok: true });
  }),
);
