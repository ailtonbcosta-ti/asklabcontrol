import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ah } from '../../utils/asyncHandler';
import { authRequired, requireRole } from '../../middleware/auth';
import { encrypt, decrypt } from '../../utils/crypto';
import { invalidatePecPool, testarConexao } from './pec.connector';

export const pecRouter = Router();
pecRouter.use(authRequired, requireRole(Role.ADMIN));

// Devolve a config atual SEM expor a senha (apenas flag "temSenha")
pecRouter.get(
  '/',
  ah(async (_req, res) => {
    const cfg = await prisma.pecConnection.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    const { senhaCriptografada, ...rest } = cfg;
    res.json({ ...rest, temSenha: !!senhaCriptografada });
  }),
);

const upsertSchema = z.object({
  ativo: z.boolean().optional(),
  host: z.string().optional().nullable(),
  porta: z.number().int().positive().optional(),
  database: z.string().optional().nullable(),
  usuario: z.string().optional().nullable(),
  senha: z.string().optional().nullable(), // se enviada, substitui; se vazia/null, mantém
  sslMode: z.enum(['disable', 'require']).optional(),
  schemaName: z.string().optional(),
});

pecRouter.put(
  '/',
  ah(async (req, res) => {
    const body = upsertSchema.parse(req.body);
    const data: any = { ...body };
    if (body.senha) data.senhaCriptografada = encrypt(body.senha);
    delete data.senha;

    const cfg = await prisma.pecConnection.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });
    invalidatePecPool();
    const { senhaCriptografada, ...rest } = cfg;
    res.json({ ...rest, temSenha: !!senhaCriptografada });
  }),
);

const testSchema = z.object({
  host: z.string().min(1),
  porta: z.number().int().positive().default(5432),
  database: z.string().min(1),
  usuario: z.string().min(1),
  senha: z.string().optional(), // opcional: se vazia, usa a salva
  sslMode: z.enum(['disable', 'require']).default('disable'),
});

pecRouter.post(
  '/testar',
  ah(async (req, res) => {
    const body = testSchema.parse(req.body);
    let senha = body.senha;
    if (!senha) {
      const cfg = await prisma.pecConnection.findUnique({ where: { id: 1 } });
      if (!cfg?.senhaCriptografada) return res.status(400).json({ ok: false, mensagem: 'Senha não informada e nenhuma salva' });
      try {
        senha = decrypt(cfg.senhaCriptografada);
      } catch (err) {
        return res.status(400).json({ ok: false, mensagem: 'A senha salva é inválida ou a chave de criptografia mudou. Por favor, digite a senha novamente e salve.' });
      }
    }
    const result = await testarConexao({
      host: body.host,
      porta: body.porta,
      database: body.database,
      usuario: body.usuario,
      senha,
      sslMode: body.sslMode,
    });
    await prisma.pecConnection.update({
      where: { id: 1 },
      data: { ultimoTesteEm: new Date(), ultimoTesteOk: result.ok, ultimoTesteMsg: result.mensagem },
    }).catch(() => undefined);
    res.json(result);
  }),
);
