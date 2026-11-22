import { Router } from 'express';
import fs from 'fs';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired, requireRole } from '../../middleware/auth';
import {
  descartarJob, getJob, iniciarBackup, jobAtualDoUsuario, jobEmAndamento, publicJob, tokenValido,
} from './backup.service';

export const backupRouter = Router();

// Download nativo do navegador: o formulário (POST) envia o token no corpo, assim ele
// não fica em URL, histórico ou logs de acesso. Não usa o header Authorization porque
// é uma navegação comum do navegador, não uma chamada do axios.
backupRouter.post('/:id/download', ah(async (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job || !tokenValido(job, req.body?.token)) throw new HttpError(404, 'Backup não encontrado ou expirado');
  if (!fs.existsSync(job.arquivo)) throw new HttpError(410, 'Arquivo de backup não está mais disponível');

  res.setHeader('Cache-Control', 'no-store');
  res.download(job.arquivo, job.nomeArquivo, { headers: { 'Content-Type': 'application/octet-stream' } }, (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Falha ao enviar o arquivo' });
  });
}));

backupRouter.use(authRequired, requireRole(Role.ADMIN));

backupRouter.post('/', ah(async (req, res) => {
  const ativo = jobEmAndamento();
  if (ativo) throw new HttpError(409, 'Já existe um backup em andamento. Aguarde a conclusão.', { id: ativo.id });

  // descarta backup anterior deste usuário (libera disco)
  const anterior = jobAtualDoUsuario(req.user!.id);
  if (anterior) descartarJob(anterior);

  const job = await iniciarBackup(req.user!.id);
  try {
    await prisma.auditLog.create({
      data: { userId: req.user!.id, acao: 'BACKUP_BANCO', entidade: 'database', entityId: job.id, ip: req.ip },
    });
  } catch { /* auditoria não deve impedir o backup */ }
  res.status(202).json(publicJob(job));
}));

backupRouter.get('/atual', (req, res) => {
  const job = jobAtualDoUsuario(req.user!.id);
  res.json(job ? publicJob(job) : null);
});

backupRouter.get('/:id', (req, res, next) => {
  const job = getJob(String(req.params.id));
  if (!job || job.userId !== req.user!.id) return next(new HttpError(404, 'Backup não encontrado'));
  res.json(publicJob(job));
});

backupRouter.delete('/:id', (req, res, next) => {
  const job = getJob(String(req.params.id));
  if (!job || job.userId !== req.user!.id) return next(new HttpError(404, 'Backup não encontrado'));
  descartarJob(job);
  res.json({ ok: true });
});
