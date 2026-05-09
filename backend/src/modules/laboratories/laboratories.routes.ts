import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ah } from '../../utils/asyncHandler';
import { authRequired, requireRole } from '../../middleware/auth';
import { isValidCnpj, onlyDigits, formatCnpj } from '../../utils/cnpj';
import { isValidPhone, onlyDigitsPhone, formatPhone } from '../../utils/phone';

export const laboratoriesRouter = Router();
laboratoriesRouter.use(authRequired);

const cnpjField = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? onlyDigits(v) : v))
  .refine((v) => !v || isValidCnpj(v), { message: 'CNPJ inválido' });

const schema = z.object({
  razaoSocial: z.string().min(2),
  nomeFantasia: z.string().optional().nullable(),
  cnpj: cnpjField,
  telefone: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? onlyDigitsPhone(v) : v))
    .refine((v) => !v || isValidPhone(v), { message: 'Telefone inválido (10 ou 11 dígitos)' }),
  endereco: z.string().optional().nullable(),
  cidade: z.string().optional().nullable(),
  uf: z.string().length(2).optional().nullable(),
  cep: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('').transform(() => null)),
  responsavel: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
});

laboratoriesRouter.get('/', ah(async (_req, res) => {
  const list = await prisma.laboratory.findMany({ orderBy: { razaoSocial: 'asc' } });
  res.json(list.map((l) => ({ ...l, cnpjFormatado: formatCnpj(l.cnpj), telefoneFormatado: formatPhone(l.telefone) })));
}));

laboratoriesRouter.post('/', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const data = schema.parse(req.body);
  res.status(201).json(await prisma.laboratory.create({ data }));
}));

laboratoriesRouter.patch('/:id', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const data = schema.partial().parse(req.body);
  res.json(await prisma.laboratory.update({ where: { id: Number(req.params.id) }, data }));
}));

laboratoriesRouter.delete('/:id', requireRole(Role.ADMIN), ah(async (req, res) => {
  await prisma.laboratory.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
  res.json({ ok: true });
}));
