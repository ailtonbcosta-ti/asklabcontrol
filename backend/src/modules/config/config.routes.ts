import { Router } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired, requireRole } from '../../middleware/auth';

const LOGO_DIR = path.join(env.UPLOAD_DIR, 'logos');
fs.mkdirSync(LOGO_DIR, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: LOGO_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.png';
    cb(null, `logo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.mimetype)) {
      return cb(new Error('Formato inválido (use PNG, JPG, WEBP, GIF ou SVG)'));
    }
    cb(null, true);
  },
});

export const configRouter = Router();
configRouter.use(authRequired);

configRouter.get('/', ah(async (_req, res) => {
  const cfg = await prisma.establishmentConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, razaoSocial: 'Estabelecimento Autorizador' },
  });
  res.json(cfg);
}));

const schema = z.object({
  razaoSocial: z.string().min(2),
  nomeFantasia: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  endereco: z.string().optional().nullable(),
  cidade: z.string().optional().nullable(),
  uf: z.string().length(2).optional().nullable(),
  cep: z.string().optional().nullable(),
  telefone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('').transform(() => null)),
  logoUrl: z.string().optional().nullable(),
  logoA4Url: z.string().optional().nullable(),
  logoThermal80Url: z.string().optional().nullable(),
  validadeAutorizacaoDias: z.number().int().positive().optional(),
  cabecalhoImpressao: z.string().optional().nullable(),
  rodapeImpressao: z.string().optional().nullable(),
});

configRouter.put('/', requireRole(Role.ADMIN), ah(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const upd = await prisma.establishmentConfig.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, razaoSocial: data.razaoSocial || 'Estabelecimento Autorizador', ...data },
  });
  res.json(upd);
}));

const tipoSchema = z.enum(['sistema', 'a4', 'thermal80']);
const FIELD_BY_TIPO: Record<z.infer<typeof tipoSchema>, 'logoUrl' | 'logoA4Url' | 'logoThermal80Url'> = {
  sistema: 'logoUrl',
  a4: 'logoA4Url',
  thermal80: 'logoThermal80Url',
};

configRouter.post(
  '/logo',
  requireRole(Role.ADMIN),
  logoUpload.single('arquivo'),
  ah(async (req, res) => {
    const tipo = tipoSchema.parse(req.query.tipo);
    if (!req.file) throw new HttpError(400, 'Arquivo não enviado');
    const url = `/api/uploads/logos/${req.file.filename}`;
    const field = FIELD_BY_TIPO[tipo];

    // remove arquivo antigo (se existir e for nosso) para não acumular
    const cur = await prisma.establishmentConfig.findUnique({ where: { id: 1 } });
    const old = cur?.[field];
    if (old && old.startsWith('/api/uploads/logos/')) {
      const oldPath = path.join(LOGO_DIR, path.basename(old));
      try { fs.unlinkSync(oldPath); } catch { /* ignore */ }
    }

    const upd = await prisma.establishmentConfig.upsert({
      where: { id: 1 },
      update: { [field]: url },
      create: { id: 1, razaoSocial: 'Estabelecimento Autorizador', [field]: url },
    });
    res.json({ url, tipo, config: upd });
  }),
);

// ─── Reset destrutivo do sistema (ADMIN) ─────────────────
configRouter.post(
  '/reset',
  requireRole(Role.ADMIN),
  ah(async (req, res) => {
    const body = z.object({ confirmacao: z.string() }).parse(req.body);
    if (body.confirmacao !== 'EXCLUIR TUDO') {
      throw new HttpError(400, 'Confirmação inválida. Digite exatamente "EXCLUIR TUDO".');
    }
    const meId = req.user!.id;

    await prisma.$transaction(async (tx) => {
      // ordem importa por causa de FKs (filhas → pais)
      await tx.authorizationItem.deleteMany();
      await tx.pendingItem.deleteMany();
      await tx.authorization.deleteMany();
      await tx.contractMonthlyBalance.deleteMany();
      await tx.contractProcedure.deleteMany();
      await tx.contract.deleteMany();
      await tx.procedure.deleteMany();
      await tx.laboratory.deleteMany();
      await tx.patient.deleteMany();
      await tx.auditLog.deleteMany();
      await tx.sigtapJob.deleteMany();
      // SIGTAP: zera competências e tabelas filhas (cascade derruba as filhas)
      await tx.sigtapCompetencia.deleteMany();
      // PEC connection: limpa
      await tx.pecConnection.deleteMany();
      // EstablishmentConfig: volta para o estado inicial
      await tx.establishmentConfig.upsert({
        where: { id: 1 },
        update: {
          razaoSocial: 'Estabelecimento Autorizador',
          nomeFantasia: null, cnpj: null, endereco: null, cidade: null, uf: null, cep: null,
          telefone: null, email: null, logoUrl: null, logoA4Url: null, logoThermal80Url: null,
          validadeAutorizacaoDias: 30, cabecalhoImpressao: null, rodapeImpressao: null,
          sigtapCompetenciaVigente: null,
        },
        create: { id: 1, razaoSocial: 'Estabelecimento Autorizador' },
      });
      // Users: mantém apenas o admin que executou o reset
      await tx.user.deleteMany({ where: { id: { not: meId } } });
    });

    // remove arquivos de logos (mantém pasta)
    try {
      for (const f of fs.readdirSync(LOGO_DIR)) {
        try { fs.unlinkSync(path.join(LOGO_DIR, f)); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    res.json({ ok: true, mensagem: 'Sistema resetado. Apenas o usuário admin atual foi preservado.' });
  }),
);

configRouter.delete(
  '/logo',
  requireRole(Role.ADMIN),
  ah(async (req, res) => {
    const tipo = tipoSchema.parse(req.query.tipo);
    const field = FIELD_BY_TIPO[tipo];
    const cur = await prisma.establishmentConfig.findUnique({ where: { id: 1 } });
    const old = cur?.[field];
    if (old && old.startsWith('/api/uploads/logos/')) {
      try { fs.unlinkSync(path.join(LOGO_DIR, path.basename(old))); } catch { /* ignore */ }
    }
    const upd = await prisma.establishmentConfig.update({
      where: { id: 1 },
      data: { [field]: null },
    });
    res.json(upd);
  }),
);
