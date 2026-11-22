import { Router } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired, requireRole } from '../../middleware/auth';

const LOGO_DIR = path.join(env.UPLOAD_DIR, 'logos');
fs.mkdirSync(LOGO_DIR, { recursive: true });

// Extensão derivada do MIME (nunca do nome enviado), para impedir upload de .html/.js
// disfarçado de imagem e servido a partir da mesma origem da aplicação.
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

const logoStorage = multer.diskStorage({
  destination: LOGO_DIR,
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype.toLowerCase()] || '.png';
    cb(null, `logo_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype.toLowerCase()]) {
      return cb(new HttpError(400, 'Formato inválido (use PNG, JPG, WEBP, GIF ou SVG)'));
    }
    cb(null, true);
  },
});

// Confere a assinatura real do arquivo (magic bytes) contra o MIME declarado.
function conteudoConfere(filePath: string, mime: string): boolean {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(512);
  const n = fs.readSync(fd, buf, 0, 512, 0);
  fs.closeSync(fd);
  const b = buf.subarray(0, n);
  switch (mime.toLowerCase()) {
    case 'image/png': return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
    case 'image/jpg': return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/gif': return b.subarray(0, 4).toString('ascii') === 'GIF8';
    case 'image/webp': return b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'image/svg+xml': {
      const txt = fs.readFileSync(filePath, 'utf8');
      if (!/<svg[\s>]/i.test(txt)) return false;
      // bloqueia conteúdo ativo dentro do SVG
      return !/<script|<foreignObject|\bon[a-z]+\s*=|javascript:|<iframe|<embed|<object/i.test(txt);
    }
    default: return false;
  }
}

export const configRouter = Router();

// Público (tela de login): apenas identidade visual, sem dados sensíveis.
configRouter.get('/public', ah(async (_req, res) => {
  const cfg = await prisma.establishmentConfig.findUnique({
    where: { id: 1 },
    select: { razaoSocial: true, nomeFantasia: true, logoUrl: true },
  });
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    razaoSocial: cfg?.razaoSocial ?? null,
    nomeFantasia: cfg?.nomeFantasia ?? null,
    logoUrl: cfg?.logoUrl ?? null,
  });
}));

configRouter.use(authRequired);

configRouter.get('/', ah(async (_req, res) => {
  const cfg = await prisma.establishmentConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, razaoSocial: 'Estabelecimento Autorizador' },
  });
  res.json(cfg);
}));

// Apenas arquivos enviados pelo próprio sistema ou URLs http(s) sem caracteres de quebra de atributo.
const logoUrlField = z
  .string()
  .regex(/^(\/api\/uploads\/logos\/[A-Za-z0-9._-]+|https?:\/\/[^\s"'<>`]+)$/, 'URL de logotipo inválida')
  .optional()
  .nullable()
  .or(z.literal('').transform(() => null));

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
  logoUrl: logoUrlField,
  logoA4Url: logoUrlField,
  logoThermal80Url: logoUrlField,
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
    if (!conteudoConfere(req.file.path, req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      throw new HttpError(400, 'O conteúdo do arquivo não corresponde a uma imagem válida');
    }
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
