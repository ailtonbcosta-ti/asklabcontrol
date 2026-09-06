import { Router } from 'express';
import { Role } from '@prisma/client';
import { authRequired, requireRole } from '../../middleware/auth';
import { ah } from '../../utils/asyncHandler';
import { prisma } from '../../config/prisma';
import { encrypt, decrypt } from '../../utils/crypto';
import {
  testarConexaoMysql, buscarAtendimentos, invalidateMysqlPool,
} from './bpa-terceiros.connector';
import {
  gerarBpaTerceiros, nomeArquivoBpa,
} from './bpa-terceiros.exporter';

export const bpaTerceirosRouter = Router();
bpaTerceirosRouter.use(authRequired, requireRole(Role.ADMIN, Role.GESTOR));

// ── GET /bpa-terceiros/config ─────────────────────────────────────────────────
bpaTerceirosRouter.get('/config', ah(async (_req, res) => {
  let cfg = await prisma.bpaTerceirosConfig.findUnique({ where: { id: 1 } });
  if (!cfg) {
    cfg = await prisma.bpaTerceirosConfig.create({
      data: { id: 1, updatedAt: new Date() },
    });
  }
  const { mysqlSenhaCriptografada, ...rest } = cfg as any;
  res.json({ ...rest, temSenha: !!mysqlSenhaCriptografada });
}));

// ── PUT /bpa-terceiros/config ─────────────────────────────────────────────────
bpaTerceirosRouter.put('/config', requireRole(Role.ADMIN), ah(async (req, res) => {
  const {
    ativo, mysqlHost, mysqlPort, mysqlDatabase, mysqlUsuario, senha, mysqlViewName,
    cnes, cnsProfissional, cbo, ine, ibgeMunicipio,
    orgaoOrigem, orgaoDestino, indicadorDestino, versao,
  } = req.body;

  const data: any = {
    ativo: !!ativo, mysqlHost, mysqlPort: Number(mysqlPort) || 3306, mysqlDatabase,
    mysqlUsuario, mysqlViewName: mysqlViewName || 'atendimentobpa',
    cnes, cnsProfissional, cbo, ine, ibgeMunicipio,
    orgaoOrigem, orgaoDestino, indicadorDestino: indicadorDestino || 'M',
    versao: versao || 'D05.00',
  };
  if (senha) data.mysqlSenhaCriptografada = encrypt(senha);

  const cfg = await prisma.bpaTerceirosConfig.upsert({
    where: { id: 1 }, create: { id: 1, ...data }, update: data,
  });
  invalidateMysqlPool();
  const { mysqlSenhaCriptografada, ...rest } = cfg as any;
  res.json({ ...rest, temSenha: !!mysqlSenhaCriptografada });
}));

// ── POST /bpa-terceiros/config/testar ────────────────────────────────────────
bpaTerceirosRouter.post('/config/testar', requireRole(Role.ADMIN), ah(async (req, res) => {
  const { mysqlHost, mysqlPort, mysqlDatabase, mysqlUsuario, senha, mysqlViewName } = req.body;

  let senhaFinal = senha;
  if (!senhaFinal) {
    const stored = await prisma.bpaTerceirosConfig.findUnique({ where: { id: 1 } });
    if (stored?.mysqlSenhaCriptografada) senhaFinal = decrypt(stored.mysqlSenhaCriptografada);
  }
  if (!senhaFinal) return res.status(400).json({ ok: false, mensagem: 'Informe a senha para testar.' });

  const result = await testarConexaoMysql({
    host: mysqlHost, port: Number(mysqlPort) || 3306, database: mysqlDatabase,
    usuario: mysqlUsuario, senha: senhaFinal, viewName: mysqlViewName || 'atendimentobpa',
  });

  await prisma.bpaTerceirosConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ultimoTesteEm: new Date(), ultimoTesteOk: result.ok, ultimoTesteMsg: result.mensagem },
    update: { ultimoTesteEm: new Date(), ultimoTesteOk: result.ok, ultimoTesteMsg: result.mensagem },
  });

  res.json(result);
}));

// ── GET /bpa-terceiros/preview?competencia=YYYYMM ────────────────────────────
bpaTerceirosRouter.get('/preview', ah(async (req, res) => {
  const competencia = String(req.query.competencia || '');
  if (!/^\d{6}$/.test(competencia)) return res.status(400).json({ error: 'competencia deve ser YYYYMM (ex: 202607)' });

  const rows = await buscarAtendimentos(competencia);
  const total = rows.length;
  const semId = rows.filter((r: any) => !r.cpf?.trim() && !r.cns?.trim()).length;
  const semCod = rows.filter((r: any) => !r.codTabela?.trim()).length;
  const qtdZero = rows.filter((r: any) => Number(r.quantidade) === 0).length;
  const incluidos = rows.filter((r: any) =>
    (r.cpf?.trim() || r.cns?.trim()) && r.codTabela?.trim() && Number(r.quantidade) > 0
  );
  const protocolos = new Set(incluidos.map((r: any) => r.protocolo)).size;
  const procedimentos = new Set(incluidos.map((r: any) => r.codTabela?.trim()).filter(Boolean)).size;
  const comEndereco = incluidos.filter((r: any) => r.logradouro?.trim()).length;

  res.json({
    competencia, total, incluidos: incluidos.length, protocolos, procedimentos,
    excluidos_sem_id: semId, excluidos_sem_codigo: semCod, excluidos_qtd_zero: qtdZero,
    com_endereco: comEndereco,
  });
}));

// ── GET /bpa-terceiros/exportar?competencia=YYYYMM ───────────────────────────
bpaTerceirosRouter.get('/exportar', ah(async (req, res) => {
  const competencia = String(req.query.competencia || '');
  if (!/^\d{6}$/.test(competencia)) return res.status(400).json({ error: 'competencia deve ser YYYYMM' });

  const cfg = await prisma.bpaTerceirosConfig.findUnique({ where: { id: 1 } });
  if (!cfg?.cnes) return res.status(400).json({ error: 'CNES não configurado em Config Sistema Terceiro.' });
  if (!cfg?.cnsProfissional) return res.status(400).json({ error: 'CNS do profissional não configurado.' });
  if (!cfg?.cbo) return res.status(400).json({ error: 'CBO não configurado.' });

  const estab = await prisma.establishmentConfig.findUnique({ where: { id: 1 } });

  const rows = await buscarAtendimentos(competencia);

  const folhaCfg = {
    cnes: cfg.cnes, competencia, cnsProfissional: cfg.cnsProfissional,
    cbo: cfg.cbo, ine: cfg.ine ?? '', ibgeMunicipio: cfg.ibgeMunicipio ?? '',
  };

  const orgaoOrigem = cfg.orgaoOrigem || estab?.nomeFantasia || estab?.razaoSocial || '';
  const sigla = orgaoOrigem.split(/\s+/)[0].substring(0, 6).toUpperCase();
  const cnpj = (estab?.cnpj ?? '').replace(/\D/g, '');

  const infoHeader = {
    competencia, orgaoOrigem, sigla,
    cgcCpf: cnpj,
    orgaoDestino: cfg.orgaoDestino || `SMS ${estab?.cidade || ''}`,
    indicadorDestino: cfg.indicadorDestino || 'M',
    versao: cfg.versao || 'D05.00',
  };

  const { buffer, invalidos, stats } = gerarBpaTerceiros(rows as any, folhaCfg, infoHeader);

  if (!buffer) {
    return res.status(422).json({
      error: 'Nenhum registro válido para exportação.',
      invalidos, stats,
    });
  }

  const nomeArquivo = nomeArquivoBpa(cfg.cnes, competencia);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  res.setHeader('X-Bpa-Stats', JSON.stringify(stats));
  if (invalidos.length) res.setHeader('X-Bpa-Invalidos', invalidos.length.toString());
  res.send(buffer);
}));
