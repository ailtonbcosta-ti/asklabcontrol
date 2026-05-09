import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired, requireRole } from '../../middleware/auth';
import { obterTabelaMaisRecente } from './sigtap.downloader';
import { executarJobFtp, processarArquivo } from './sigtap.service';

fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: env.UPLOAD_DIR, limits: { fileSize: 200 * 1024 * 1024 } });

export const sigtapRouter = Router();
sigtapRouter.use(authRequired);

sigtapRouter.get(
  '/competencias',
  ah(async (_req, res) => {
    const list = await prisma.sigtapCompetencia.findMany({
      orderBy: { competencia: 'desc' },
      include: { _count: { select: { procedimentos: true } } },
    });
    res.json(list);
  }),
);

sigtapRouter.get(
  '/competencia-vigente',
  ah(async (_req, res) => {
    const cfg = await prisma.establishmentConfig.findUnique({ where: { id: 1 } });
    const vigente = cfg?.sigtapCompetenciaVigente || null;
    const comp = vigente ? await prisma.sigtapCompetencia.findUnique({ where: { competencia: vigente } }) : null;
    res.json({ competencia: vigente, registro: comp });
  }),
);

sigtapRouter.put(
  '/competencia-vigente',
  requireRole(Role.ADMIN),
  ah(async (req, res) => {
    const { competencia } = req.body as { competencia: string };
    const c = await prisma.sigtapCompetencia.findUnique({ where: { competencia } });
    if (!c) throw new HttpError(404, 'Competência não importada');
    await prisma.establishmentConfig.update({ where: { id: 1 }, data: { sigtapCompetenciaVigente: competencia } });
    res.json({ ok: true, competencia });
  }),
);

sigtapRouter.get(
  '/procedimentos',
  ah(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const competenciaParam = String(req.query.competencia || '').trim();
    if (q.length < 3) return res.json([]);

    let comp = competenciaParam
      ? await prisma.sigtapCompetencia.findUnique({ where: { competencia: competenciaParam } })
      : null;
    if (!comp) {
      const cfg = await prisma.establishmentConfig.findUnique({ where: { id: 1 } });
      if (cfg?.sigtapCompetenciaVigente)
        comp = await prisma.sigtapCompetencia.findUnique({ where: { competencia: cfg.sigtapCompetenciaVigente } });
    }
    if (!comp) comp = await prisma.sigtapCompetencia.findFirst({ orderBy: { competencia: 'desc' } });
    if (!comp) return res.json([]);

    const onlyDigits = /^\d+$/.test(q);
    const where = onlyDigits
      ? { competenciaId: comp.id, codigo: { startsWith: q } }
      : { competenciaId: comp.id, descricao: { contains: q, mode: 'insensitive' as const } };

    const lista = await prisma.sigtapProcedimento.findMany({
      where,
      take: 25,
      orderBy: onlyDigits ? { codigo: 'asc' } : { descricao: 'asc' },
      select: { codigo: true, descricao: true, complexidade: true, tpSexo: true },
    });
    res.json(lista);
  }),
);

sigtapRouter.get(
  '/procedimentos/:codigo',
  ah(async (req, res) => {
    const codigo = req.params.codigo;
    const cfg = await prisma.establishmentConfig.findUnique({ where: { id: 1 } });
    const competencia = String(req.query.competencia || cfg?.sigtapCompetenciaVigente || '');
    if (!competencia) throw new HttpError(404, 'Sem competência vigente');
    const comp = await prisma.sigtapCompetencia.findUnique({ where: { competencia } });
    if (!comp) throw new HttpError(404, 'Competência não encontrada');
    const proc = await prisma.sigtapProcedimento.findUnique({ where: { competenciaId_codigo: { competenciaId: comp.id, codigo } } });
    if (!proc) throw new HttpError(404, 'Procedimento não encontrado');
    const filtro = { competenciaId: comp.id, codigoProcedimento: codigo };
    const [cbos, servicos, cids, atributos, regras, habilitacoes, registros] = await Promise.all([
      prisma.sigtapProcCbo.findMany({ where: filtro }),
      prisma.sigtapProcServico.findMany({ where: filtro }),
      prisma.sigtapProcCid.findMany({ where: filtro }),
      prisma.sigtapProcAtributo.findMany({ where: filtro }),
      prisma.sigtapProcRegra.findMany({ where: filtro }),
      prisma.sigtapProcHabilitacao.findMany({ where: filtro }),
      prisma.sigtapProcRegistro.findMany({ where: filtro }),
    ]);
    res.json({ competencia, procedimento: proc, cbos, servicos, cids, atributos, regras, habilitacoes, registros });
  }),
);

sigtapRouter.post(
  '/baixar-datasus',
  requireRole(Role.ADMIN),
  ah(async (req, res) => {
    const ftp = await obterTabelaMaisRecente().catch((e) => {
      throw new HttpError(502, `Falha FTP: ${e.message}`);
    });
    if (!ftp) throw new HttpError(404, 'Nenhuma TabelaUnificada encontrada');

    const job = await prisma.sigtapJob.create({
      data: { tipo: 'FTP_DOWNLOAD', status: 'PENDING', arquivo: ftp.nome, competencia: ftp.competencia },
    });
    setImmediate(() => executarJobFtp(job.id));
    res.status(202).json({ jobId: job.id, ftp });
  }),
);

sigtapRouter.post(
  '/importar',
  requireRole(Role.ADMIN),
  upload.single('arquivo'),
  ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Arquivo não enviado');
    const resumo = await processarArquivo(req.file.path, req.file.originalname, {
      origem: 'UPLOAD',
      userId: req.user!.id,
    });
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    res.json(resumo);
  }),
);

sigtapRouter.get(
  '/jobs/:id',
  ah(async (req, res) => {
    const job = await prisma.sigtapJob.findUnique({ where: { id: Number(req.params.id) } });
    if (!job) throw new HttpError(404, 'Job não encontrado');
    res.json(job);
  }),
);

sigtapRouter.delete(
  '/competencias/:id',
  requireRole(Role.ADMIN),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.sigtapCompetencia.delete({ where: { id } });
    res.json({ ok: true });
  }),
);
